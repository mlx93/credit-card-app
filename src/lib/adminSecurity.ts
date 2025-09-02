import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Admin email addresses that can access debug endpoints
const ADMIN_EMAILS = ['mylesethan93@gmail.com'];

export interface SecurityCheckOptions {
  requireDebugKey?: boolean;
  logAccess?: boolean;
  endpointName?: string;
}

/**
 * Security middleware for admin-only endpoints
 * Returns null if authorized, or NextResponse with error if unauthorized
 */
export async function requireAdminAccess(
  request: Request, 
  options: SecurityCheckOptions = {}
): Promise<NextResponse | null> {
  const { requireDebugKey = false, logAccess = true, endpointName = 'debug endpoint' } = options;

  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      if (logAccess) {
        console.log(`🚫 Unauthenticated access attempt to ${endpointName}`);
      }
      return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
    }

    // Check if user is admin
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isAdmin = ADMIN_EMAILS.includes(session.user.email || '');
    
    if (!isDevelopment && !isAdmin) {
      if (logAccess) {
        console.log(`🚫 Unauthorized access attempt to ${endpointName} by:`, session.user.email);
      }
      return NextResponse.json({ 
        error: 'Forbidden: Admin access required',
        hint: 'This endpoint is restricted to authorized administrators only.'
      }, { status: 403 });
    }

    // Check debug key in production if required
    if (requireDebugKey && process.env.NODE_ENV === 'production') {
      const debugAccessKey = process.env.ADMIN_DEBUG_KEY;
      const { searchParams } = new URL(request.url);
      const providedKey = searchParams.get('key');
      
      if (debugAccessKey && providedKey !== debugAccessKey) {
        if (logAccess) {
          console.log(`🚫 Invalid debug key provided for ${endpointName} by:`, session.user.email);
        }
        return NextResponse.json({ 
          error: 'Forbidden: Invalid access key',
          hint: 'This endpoint requires a valid debug key in production.'
        }, { status: 403 });
      }
    }

    // Log successful access
    if (logAccess) {
      console.log(`✅ Admin access granted to ${endpointName} for:`, session.user.email);
    }

    return null; // Authorization successful
  } catch (error) {
    console.error(`❌ Security check failed for ${endpointName}:`, error);
    return NextResponse.json({ error: 'Internal security error' }, { status: 500 });
  }
}

/**
 * Security middleware that returns session if authorized
 * Returns {session, error} where error is NextResponse if unauthorized
 */
export async function requireAdminWithSession(
  request: Request,
  options: SecurityCheckOptions = {}
): Promise<{ session: any | null; error: NextResponse | null }> {
  const securityError = await requireAdminAccess(request, options);
  if (securityError) {
    return { session: null, error: securityError };
  }
  
  const session = await getServerSession(authOptions);
  return { session, error: null };
}

/**
 * Check if current user is an admin (for use in components/other contexts)
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    const session = await getServerSession(authOptions);
    return ADMIN_EMAILS.includes(session?.user?.email || '');
  } catch {
    return false;
  }
}