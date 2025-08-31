import { NextAuthOptions } from 'next-auth';
import { SupabaseAdapter } from '@next-auth/supabase-adapter';
import GoogleProvider from 'next-auth/providers/google';

export const authOptions: NextAuthOptions = {
  adapter: SupabaseAdapter({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    secret: process.env.SUPABASE_SERVICE_ROLE_KEY!,
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
      // After successful sign-in, ensure user exists in our public.users table
      if (user.email) {
        try {
          const { createClient } = await import('@supabase/supabase-js');
          const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );
          
          // Insert or update user in public.users table
          await supabase
            .from('users')
            .upsert({
              id: user.id,
              email: user.email,
              name: user.name,
              image: user.image,
              updatedAt: new Date().toISOString(),
            })
            .onConflict('id');
        } catch (error) {
          console.error('Error syncing user to public.users:', error);
        }
      }
      return true;
    },
  },
  session: {
    strategy: 'database',
  },
  secret: process.env.NEXTAUTH_SECRET,
};