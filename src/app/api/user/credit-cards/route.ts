import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const creditCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          userId: session.user.id,
        },
      },
      include: {
        plaidItem: {
          select: {
            institutionName: true,
          },
        },
        aprs: true,
        _count: {
          select: {
            transactions: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ creditCards });
  } catch (error) {
    console.error('Error fetching credit cards:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}