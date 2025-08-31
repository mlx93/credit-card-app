import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { createClient } from '@supabase/supabase-js';

// Create Supabase client for NextAuth operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const authOptions: NextAuthOptions = {
  debug: process.env.NODE_ENV === 'development',
  // Use database strategy without adapter to avoid schema issues
  session: {
    strategy: 'jwt', // Use JWT instead of database sessions to avoid schema issues
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      id: 'email-code',
      name: 'Email Verification',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Verification Code', type: 'text' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.code) {
          return null;
        }

        try {
          // First try to get verification code from verification_tokens table
          let verification: any = null;
          let verifyError: any = null;
          
          const { data: tokenData, error: tokenError } = await supabase
            .from('verification_tokens')
            .select('token, expires')
            .eq('identifier', credentials.email)
            .single();
            
          if (!tokenError && tokenData) {
            verification = tokenData;
          } else {
            // Fallback: Check users table for verification code
            const { data: userData, error: userError } = await supabase
              .from('users')
              .select('verificationCode, verificationExpires')
              .eq('email', credentials.email)
              .single();
              
            if (!userError && userData && userData.verificationCode) {
              verification = {
                token: userData.verificationCode,
                expires: userData.verificationExpires
              };
            }
          }

          if (!verification) {
            console.log('No verification code found for:', credentials.email);
            return null;
          }

          // Check if code matches and is not expired
          if (verification.token !== credentials.code || 
              new Date() > new Date(verification.expires)) {
            console.log('Invalid or expired code for:', credentials.email);
            return null;
          }

          // Code is valid! Get or create user
          const { data: existingUser } = await supabase
            .from('users')
            .select('id, email, name, image')
            .eq('email', credentials.email)
            .single();

          let user;
          if (!existingUser) {
            // Create new user
            const userId = crypto.randomUUID();
            const { data: newUser, error: createError } = await supabase
              .from('users')
              .insert({
                id: userId,
                email: credentials.email,
                updatedAt: new Date().toISOString(),
              })
              .select('id, email, name, image')
              .single();

            if (createError || !newUser) {
              return null;
            }
            user = newUser;
          } else {
            user = existingUser;
          }

          // Clean up used verification token from both tables
          await supabase
            .from('verification_tokens')
            .delete()
            .eq('identifier', credentials.email);
            
          // Also clear from users table if stored there
          await supabase
            .from('users')
            .update({
              verificationCode: null,
              verificationExpires: null
            })
            .eq('email', credentials.email);

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
          };
        } catch (error) {
          console.error('Email verification error:', error);
          return null;
        }
      }
    }),
  ],
  callbacks: {
    session: async ({ session, token }) => {
      // Add user ID from token to session
      if (session?.user && token?.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
    signIn: async ({ user, account, profile }) => {
      // Create/update user in our database
      if (user.email) {
        try {
          // Check if user already exists
          const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', user.email)
            .single();

          if (!existingUser) {
            // Generate a UUID for the new user
            const userId = crypto.randomUUID();
            
            // Create new user with UUID
            const { data: newUser, error } = await supabase
              .from('users')
              .insert({
                id: userId,
                email: user.email,
                name: user.name,
                image: user.image,
                updatedAt: new Date().toISOString(),
              })
              .select('id')
              .single();

            if (error) {
              console.error('Error creating user:', error);
              return false;
            }

            // Set the user ID for the session
            user.id = newUser.id;
          } else {
            // Update existing user
            await supabase
              .from('users')
              .update({
                name: user.name,
                image: user.image,
                updatedAt: new Date().toISOString(),
              })
              .eq('email', user.email);
            
            user.id = existingUser.id;
          }

          console.log('User handled successfully:', user.email);
        } catch (error) {
          console.error('Error handling user:', error);
          return false;
        }
      }
      return true;
    },
  },
  events: {
    async signIn({ user, account, profile, isNewUser }) {
      console.log('NextAuth signIn event:', { 
        user: user?.email, 
        account: account?.provider,
        isNewUser 
      });
    },
    async signOut({ token, session }) {
      console.log('NextAuth signOut event');
    },
    async createUser({ user }) {
      console.log('NextAuth createUser event:', user?.email);
    },
    async linkAccount({ user, account, profile }) {
      console.log('NextAuth linkAccount event:', { 
        user: user?.email, 
        provider: account.provider 
      });
    },
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