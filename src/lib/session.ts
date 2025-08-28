import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function getSession() {
  try {
    return await getServerSession(authOptions);
  } catch (error) {
    console.warn('Session error (likely due to invalid JWT cookie):', error);
    // Return null session if JWT is invalid - this will show logged out state
    return null;
  }
}