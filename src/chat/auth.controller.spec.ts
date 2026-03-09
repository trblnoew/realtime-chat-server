import { BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  it('does not call Supabase signup when local profile check fails', async () => {
    const chatStore = {
      assertSignupProfileAvailable: jest
        .fn()
        .mockRejectedValue(new BadRequestException('nickname already used')),
      upsertUserFromAuth: jest.fn(),
      getUserById: jest.fn(),
      getUsers: jest.fn(),
    };
    const supabaseAuth = {
      signUp: jest.fn(),
      signIn: jest.fn(),
    };
    const controller = new AuthController(chatStore as never, supabaseAuth as never);

    await expect(
      controller.signup({
        email: 'new@test.com',
        password: 'Passw0rd!',
        nickname: 'duplicate',
      }),
    ).rejects.toThrow('nickname already used');

    expect(chatStore.assertSignupProfileAvailable).toHaveBeenCalledWith(
      'new@test.com',
      'duplicate',
    );
    expect(supabaseAuth.signUp).not.toHaveBeenCalled();
  });

  it('returns only id and nickname from users endpoint payload', async () => {
    const chatStore = {
      assertSignupProfileAvailable: jest.fn(),
      upsertUserFromAuth: jest.fn(),
      getUserById: jest.fn(),
      getUsers: jest.fn().mockResolvedValue([
        { id: 'user-1', email: 'user1@test.com', nickname: 'user1' },
      ]),
    };
    const supabaseAuth = {
      signUp: jest.fn(),
      signIn: jest.fn(),
    };
    const controller = new AuthController(chatStore as never, supabaseAuth as never);

    await expect(controller.getUsers()).resolves.toEqual({
      users: [{ id: 'user-1', nickname: 'user1' }],
    });
  });
});
