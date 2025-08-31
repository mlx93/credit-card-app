import { NextAuthOptions } from 'next-auth';
import { SupabaseAdapter } from '@next-auth/supabase-adapter';
import GoogleProvider from 'next-auth/providers/google';

export const authOptions: NextAuthOptions = {
  debug: true,
  adapter: SupabaseAdapter({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    secret: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    options: {
      schema: 'next_auth'
    }
  }),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    session: async ({ session, user }) => {
      if (session?.user && user) {
        session.user.id = user.id;
      }
      return session;
    },
    signIn: async ({ user, account, profile }) => {
      // After NextAuth creates the user, sync to public.users table
      if (user.email && user.id) {
        try {
          const { createClient } = await import('@supabase/supabase-js');
          const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );
          
          // Sync NextAuth user to public.users table using the same UUID
          await supabase
            .from('users')
            .upsert({
              id: user.id, // Use NextAuth's UUID
              email: user.email,
              name: user.name,
              image: user.image,
              updatedAt: new Date().toISOString(),
            })
            .onConflict('id');
          
          console.log('User synced to public.users:', user.email);
        } catch (error) {
          console.error('Error syncing user to public.users:', error);
          // Don't fail the sign-in if sync fails
        }
      }
      return true;
    },
  },
  session: {
    strategy: 'database',
  },
  logger: {
    error(code, metadata) {
      console.error('NextAuth Error:', code, metadata);
    },
    warn(code) {
      console.warn('NextAuth Warning:', code);
    },
    debug(code, metadata) {
      console.log('NextAuth Debug:', code, metadata);
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};