import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from './../src/app.module';

describe('Social APIs (e2e)', () => {
  let app: INestApplication;

  const userA = `u_${randomUUID().slice(0, 8)}`;
  const roomId = `room_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('supports signup/login and room APIs', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ userId: userA })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ userId: userA })
      .expect(201);

    const authCookie = `rt_auth_user=${encodeURIComponent(userA)}`;
    await request(app.getHttpServer())
      .post('/social/rooms')
      .set('Cookie', authCookie)
      .send({ roomId })
      .expect(201);

    const roomsResponse = await request(app.getHttpServer())
      .get('/social/rooms')
      .set('Cookie', authCookie)
      .expect(200);

    expect(Array.isArray(roomsResponse.body.rooms)).toBe(true);
    expect(roomsResponse.body.rooms).toEqual(
      expect.arrayContaining([expect.objectContaining({ roomId })]),
    );
  });

  it('supports afterSeq query parameter on room messages API', async () => {
    const authCookie = `rt_auth_user=${encodeURIComponent(userA)}`;
    const response = await request(app.getHttpServer())
      .get(`/social/rooms/${encodeURIComponent(roomId)}/messages?afterSeq=0&limit=10`)
      .set('Cookie', authCookie)
      .expect(200);

    expect(Array.isArray(response.body.messages)).toBe(true);
  });
});
