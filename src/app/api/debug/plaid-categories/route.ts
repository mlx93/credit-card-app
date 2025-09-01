import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PlaidApi, Configuration, PlaidEnvironments } from 'plaid';

const plaidClient = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  })
);

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get categories from Plaid
    const categoriesResponse = await plaidClient.categoriesGet({});
    
    // Sample a few categories to see the structure
    const sampleCategories = categoriesResponse.data.categories.slice(0, 10);
    
    return NextResponse.json({
      totalCategories: categoriesResponse.data.categories.length,
      sampleCategories: sampleCategories.map(cat => ({
        category_id: cat.category_id,
        group: cat.group,
        hierarchy: cat.hierarchy,
      })),
      exampleMappings: {
        "10001000": categoriesResponse.data.categories.find(c => c.category_id === "10001000"),
        "13005000": categoriesResponse.data.categories.find(c => c.category_id === "13005000"), // Food & Drink
        "22001000": categoriesResponse.data.categories.find(c => c.category_id === "22001000"), // Transportation
      }
    });
  } catch (error) {
    console.error('Error fetching Plaid categories:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch categories', 
      details: error.message 
    }, { status: 500 });
  }
}