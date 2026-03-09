import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from './../src/app.module';

describe('Social APIs (e2e)', () => {
  let app: INestApplication;
  let accessToken = '';
  let secondAccessToken = '';
  let firstUserId = '';
  let secondUserId = '';

  const email = `user_${randomUUID().slice(0, 8)}@test.com`;
  const password = 'Passw0rd!';
  const nickname = `nick_${randomUUID().slice(0, 6)}`;
  const secondEmail = `user_${randomUUID().slice(0, 8)}@test.com`;
  const secondNickname = `nick_${randomUUID().slice(0, 6)}`;
  const retryEmail = `user_${randomUUID().slice(0, 8)}@test.com`;
  const retryNickname = `nick_${randomUUID().slice(0, 6)}`;
  const roomId = `room_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    process.env.SUPABASE_AUTH_MOCK = 'true';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('supports supabase-style signup/login and protected room APIs', async () => {
    const signupResponse = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password, nickname })
      .expect(201);

    expect(signupResponse.body.user).toEqual(
      expect.objectContaining({ email, nickname }),
    );

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    expect(typeof loginResponse.body.accessToken).toBe('string');
    accessToken = loginResponse.body.accessToken;
    firstUserId = loginResponse.body.user.id;

    await request(app.getHttpServer())
      .post('/social/rooms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ roomId })
      .expect(201);

    const roomsResponse = await request(app.getHttpServer())
      .get('/social/rooms')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(roomsResponse.body.rooms)).toBe(true);
    expect(roomsResponse.body.rooms).toEqual(
      expect.arrayContaining([expect.objectContaining({ roomId })]),
    );
  });

  it('supports afterSeq query parameter on room messages API', async () => {
    const response = await request(app.getHttpServer())
      .get(`/social/rooms/${encodeURIComponent(roomId)}/messages?afterSeq=0&limit=10`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(response.body.messages)).toBe(true);
  });

  it('protects auth users endpoint and omits email field', async () => {
    await request(app.getHttpServer()).get('/auth/users').expect(401);

    const response = await request(app.getHttpServer())
      .get('/auth/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(response.body.users)).toBe(true);
    expect(response.body.users).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: firstUserId, nickname })]),
    );
    expect(response.body.users[0]).not.toHaveProperty('email');
  });

  it('returns 401 without bearer token', async () => {
    await request(app.getHttpServer()).get('/social/rooms').expect(401);
  });

  it('supports friend request create and accept flow', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: secondEmail, password, nickname: secondNickname })
      .expect(201);

    const secondLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: secondEmail, password })
      .expect(201);
    secondAccessToken = secondLogin.body.accessToken;
    secondUserId = secondLogin.body.user.id;

    const requestCreated = await request(app.getHttpServer())
      .post('/social/friend-requests')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ toNickname: secondNickname })
      .expect(201);
    expect(requestCreated.body.request.status).toBe('pending');

    const incoming = await request(app.getHttpServer())
      .get('/social/friend-requests/incoming')
      .set('Authorization', `Bearer ${secondAccessToken}`)
      .expect(200);
    expect(Array.isArray(incoming.body.requests)).toBe(true);
    expect(incoming.body.requests).toHaveLength(1);

    const requestId = incoming.body.requests[0].id;
    await request(app.getHttpServer())
      .post(`/social/friend-requests/${encodeURIComponent(requestId)}/accept`)
      .set('Authorization', `Bearer ${secondAccessToken}`)
      .expect(201);

    const firstFriends = await request(app.getHttpServer())
      .get(`/social/friends/${encodeURIComponent(firstUserId)}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(firstFriends.status).toBe(200);
    expect(firstFriends.body.friends).toEqual(expect.arrayContaining([secondUserId]));

    const secondFriends = await request(app.getHttpServer())
      .get(`/social/friends/${encodeURIComponent(secondUserId)}`)
      .set('Authorization', `Bearer ${secondAccessToken}`);
    expect(secondFriends.status).toBe(200);
    expect(secondFriends.body.friends).toEqual(expect.arrayContaining([firstUserId]));
  });

  it('fails fast on duplicate nickname and allows same email retry with new nickname', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: retryEmail, password, nickname })
      .expect(400);

    const retrySignup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: retryEmail, password, nickname: retryNickname })
      .expect(201);
    expect(retrySignup.body.user).toEqual(
      expect.objectContaining({ email: retryEmail, nickname: retryNickname }),
    );
  });
});
