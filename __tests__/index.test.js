import { jest } from '@jest/globals';
import request from 'supertest';

// Mock the pg module so tests don't try to connect to a real database
jest.unstable_mockModule('pg', () => {
    return {
        default: {
            Pool: jest.fn(() => ({
                query: jest.fn(),
                end: jest.fn()
            }))
        }
    };
});

// Since index.js connects immediately, we must mock pg BEFORE importing it
const { app, db } = await import('../index.js');

describe('Books4U Express Routes', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(async () => {
        await db.end();
    });

    it('should return 200 for the login route', async () => {
        const response = await request(app).get('/login');
        expect(response.statusCode).toBe(200);
        expect(response.text).toContain('Login'); // Checking some content from the view
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
    
    it('should return 404 for an unknown route', async () => {
        const response = await request(app).get('/nonexistent-page');
        expect(response.statusCode).toBe(404);
    });
});

