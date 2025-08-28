import Link from 'next/link';
import { CreditCard, TrendingUp, Calendar, DollarSign } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex justify-center mb-8">
            <div className="bg-white p-4 rounded-full shadow-lg">
              <CreditCard className="h-16 w-16 text-indigo-600" />
            </div>
          </div>
          
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Credit Card Manager
          </h1>
          
          <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto">
            Track your credit card spending, billing cycles, due dates, and APR costs. 
            Get insights across all your cards with secure Plaid integration.
          </p>
          
          <div className="grid md:grid-cols-2 gap-8 mb-12">
            <div className="bg-white p-8 rounded-xl shadow-lg">
              <TrendingUp className="h-12 w-12 text-green-600 mb-4 mx-auto" />
              <h3 className="text-2xl font-semibold mb-4">Spending Insights</h3>
              <p className="text-gray-600">
                Track spending by billing cycle across all your credit cards. 
                See exactly where your money goes each month.
              </p>
            </div>
            
            <div className="bg-white p-8 rounded-xl shadow-lg">
              <Calendar className="h-12 w-12 text-blue-600 mb-4 mx-auto" />
              <h3 className="text-2xl font-semibold mb-4">Due Date Tracking</h3>
              <p className="text-gray-600">
                Never miss a payment again. Get a clear view of all your 
                credit card due dates and minimum payments.
              </p>
            </div>
            
            <div className="bg-white p-8 rounded-xl shadow-lg">
              <DollarSign className="h-12 w-12 text-red-600 mb-4 mx-auto" />
              <h3 className="text-2xl font-semibold mb-4">APR Calculator</h3>
              <p className="text-gray-600">
                See exactly how much interest you&apos;ll pay if you carry a balance. 
                Make informed decisions about your credit card usage.
              </p>
            </div>
            
            <div className="bg-white p-8 rounded-xl shadow-lg">
              <CreditCard className="h-12 w-12 text-purple-600 mb-4 mx-auto" />
              <h3 className="text-2xl font-semibold mb-4">Secure Integration</h3>
              <p className="text-gray-600">
                Powered by Plaid&apos;s secure banking infrastructure. 
                Your credentials never touch our servers.
              </p>
            </div>
          </div>
          
          <div className="space-y-4">
            <Link 
              href="/dashboard"
              className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-8 py-4 rounded-lg transition-colors text-lg shadow-lg"
            >
              Go to Dashboard
            </Link>
            
            <div className="text-sm text-gray-500">
              <p>Connect your credit cards securely through Plaid</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
