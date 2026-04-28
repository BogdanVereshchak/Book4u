import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Mock the pg module so tests don't try to connect to a real database
jest.unstable_mockModule('pg', () => {
    return {
        default: {
            Pool: jest.fn(() => ({
                query: jest.fn().mockResolvedValue({ rows: [] }),
                end: jest.fn()
            }))
        }
    };
});

const mockAxios = {
    get: jest.fn().mockResolvedValue({ data: { docs: [] } })
};

jest.unstable_mockModule('axios', () => {
    return {
        default: mockAxios
    };
});

// Since index.js connects immediately, we must mock pg BEFORE importing it
const { app, db } = await import('../index.js');

describe('Books4U Express Routes', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.SECRET_KEY = 'test_secret';
    });

    afterAll(async () => {
        await db.end();
    });

    it('should return 200 for the login route', async () => {
        const response = await request(app).get('/login');
        expect(response.statusCode).toBe(200);
        expect(response.text).toContain('Login');
    });

    it('should return 200 for the register route', async () => {
        const response = await request(app).get('/register');
        expect(response.statusCode).toBe(200);
        expect(response.text).toContain('Register');
    });

    it('should redirect unauthenticated users on root path', async () => {
        const response = await request(app).get('/');
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe('/login');
    });

    it('should allow authenticated users to view the root path', async () => {
        const token = jwt.sign({ id: 1, name: 'testuser' }, process.env.SECRET_KEY);
        const response = await request(app)
            .get('/')
            .set('Cookie', `accessToken=${token}`);
        
        expect(response.statusCode).toBe(200);
        expect(response.text).toContain('Welcome to the Book4U');
    });

    it('should handle search queries', async () => {
        const token = jwt.sign({ id: 1, name: 'testuser' }, process.env.SECRET_KEY);
        const response = await request(app)
            .get('/search?bookName=Harry+Potter')
            .set('Cookie', `accessToken=${token}`);
        
        expect(mockAxios.get).toHaveBeenCalledWith(expect.stringContaining('Harry Potter'));
        expect(response.statusCode).toBe(200);
    });

    it('should log out users and clear cookie', async () => {
        const token = jwt.sign({ id: 1, name: 'testuser' }, process.env.SECRET_KEY);
        const response = await request(app)
            .get('/logout')
            .set('Cookie', `accessToken=${token}`);
        
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe('/login');
        expect(response.headers['set-cookie'][0]).toContain('accessToken=;');
    });
    
    it('should return 404 for an unknown route', async () => {
        const response = await request(app).get('/nonexistent-page');
        expect(response.statusCode).toBe(404);
    });
});

