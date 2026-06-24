import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@/api/client';
import Login from '@/pages/Login';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
}));

vi.mock('@/auth/use-auth', () => ({
  useAuth: () => ({
    login: mocks.login,
  }),
}));

function renderLogin() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Login />
    </MemoryRouter>,
  );
}

describe('Login', () => {
  afterEach(() => {
    mocks.login.mockReset();
  });

  it('shows invalid credentials when the backend rejects a filled login form', async () => {
    mocks.login.mockRejectedValueOnce(new ApiError('Invalid username or password', 401));
    renderLogin();

    fireEvent.change(screen.getByLabelText(/username or email/i), {
      target: { value: 'wrong.user' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
    expect(screen.getByText(/username or password you entered is incorrect/i)).toBeInTheDocument();
  });
});
