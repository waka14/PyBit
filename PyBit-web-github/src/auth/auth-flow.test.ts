import { describe, expect, it } from 'vitest';
import { getAuthCallbackState } from './supabaseClient';

describe('Supabase invite and password-recovery callback detection', () => {
  it('recognizes invite callbacks from query or hash parameters', () => {
    expect(getAuthCallbackState('https://app.example/?type=invite')).toEqual({ mode: 'invite', error: null });
    expect(getAuthCallbackState('https://app.example/#type=invite&access_token=example')).toEqual({ mode: 'invite', error: null });
  });
  it('recognizes password recovery and invalid/expired links without treating them as signup', () => {
    expect(getAuthCallbackState('https://app.example/?auth=recovery')).toEqual({ mode: 'recovery', error: null });
    expect(getAuthCallbackState('https://app.example/?type=invite&error_code=otp_expired')).toEqual({ mode: 'invite', error: 'invite_expired' });
    expect(getAuthCallbackState('https://app.example/?type=recovery&error=access_denied')).toEqual({ mode: 'recovery', error: 'recovery_expired' });
    expect(getAuthCallbackState('https://app.example/?error=bad_request')).toEqual({ mode: null, error: 'invalid' });
  });
});
