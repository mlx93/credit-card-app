import Link from 'next/link';
import { Shield, ArrowLeft } from 'lucide-react';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center mb-8">
          <Link 
            href="/" 
            className="flex items-center text-indigo-600 hover:text-indigo-700 transition-colors mr-6"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back to Home
          </Link>
          <div className="flex items-center">
            <Shield className="h-8 w-8 text-indigo-600 mr-3" />
            <h1 className="text-3xl font-bold text-gray-900">Privacy Policy</h1>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8 space-y-8">
          {/* Last Updated */}
          <div className="text-sm text-gray-500 border-b pb-4">
            <p><strong>Last Updated:</strong> {new Date().toLocaleDateString()}</p>
          </div>

          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Introduction</h2>
            <p className="text-gray-700 leading-relaxed">
              Welcome to CardCycle ("we," "our," or "us"). We are committed to protecting your privacy and personal information. 
              This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our 
              credit card management application at cardcycle.app.
            </p>
          </section>

          {/* Information We Collect */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Information We Collect</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">Financial Data</h3>
            <p className="text-gray-700 mb-4">
              Through our secure integration with Plaid, we access your credit card account information including:
            </p>
            <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-2">
              <li>Credit card account details (balances, limits, due dates)</li>
              <li>Transaction history and spending patterns</li>
              <li>Billing cycle information</li>
              <li>APR and interest rate information</li>
              <li>Payment history and minimum payment amounts</li>
            </ul>

            <h3 className="text-xl font-medium text-gray-800 mb-3">Account Information</h3>
            <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-2">
              <li>Email address (for account creation and authentication)</li>
              <li>Name (if provided during signup)</li>
              <li>Authentication tokens and session data</li>
            </ul>

            <h3 className="text-xl font-medium text-gray-800 mb-3">Usage Data</h3>
            <ul className="list-disc pl-6 text-gray-700 space-y-2">
              <li>App usage patterns and feature interactions</li>
              <li>Device information and browser type</li>
              <li>IP addresses and general location data</li>
            </ul>
          </section>

          {/* How We Use Your Information */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">How We Use Your Information</h2>
            <p className="text-gray-700 mb-4">We use your information to:</p>
            <ul className="list-disc pl-6 text-gray-700 space-y-2">
              <li>Provide credit card management and tracking services</li>
              <li>Display your account balances, due dates, and spending analytics</li>
              <li>Calculate APR costs and payment projections</li>
              <li>Sync and update your financial data in real-time</li>
              <li>Ensure account security and prevent unauthorized access</li>
              <li>Improve our services and user experience</li>
              <li>Send important account notifications and updates</li>
            </ul>
          </section>

          {/* Data Security */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Data Security</h2>
            <p className="text-gray-700 mb-4">
              We take your financial security seriously and implement multiple layers of protection:
            </p>
            <ul className="list-disc pl-6 text-gray-700 space-y-2">
              <li><strong>Plaid Integration:</strong> Your banking credentials never touch our servers. We use Plaid's secure, bank-grade infrastructure</li>
              <li><strong>Encryption:</strong> All data is encrypted in transit using TLS/SSL and at rest using industry-standard encryption</li>
              <li><strong>Access Controls:</strong> Strict access controls ensure only authorized personnel can access systems</li>
              <li><strong>Regular Audits:</strong> We conduct regular security audits and vulnerability assessments</li>
              <li><strong>Data Minimization:</strong> We only collect and store data necessary for our services</li>
            </ul>
          </section>

          {/* Third-Party Services */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Third-Party Services</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">Plaid</h3>
            <p className="text-gray-700 mb-4">
              We use Plaid to securely connect to your financial institutions. Plaid's privacy policy governs 
              their collection and use of your financial data. You can review Plaid's privacy policy at 
              <a href="https://plaid.com/legal/privacy/" className="text-indigo-600 hover:text-indigo-700"> plaid.com/legal/privacy/</a>.
            </p>

            <h3 className="text-xl font-medium text-gray-800 mb-3">Supabase</h3>
            <p className="text-gray-700">
              We use Supabase for secure data storage and authentication. Your data is stored in compliance with 
              industry security standards and data protection regulations.
            </p>
          </section>

          {/* Data Sharing */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Data Sharing and Disclosure</h2>
            <p className="text-gray-700 mb-4">
              We do not sell, rent, or trade your personal or financial information to third parties. We may share 
              your information only in the following limited circumstances:
            </p>
            <ul className="list-disc pl-6 text-gray-700 space-y-2">
              <li>With your explicit consent</li>
              <li>To comply with legal obligations or court orders</li>
              <li>To protect our rights, privacy, safety, or property</li>
              <li>In connection with a business transfer or merger (with prior notice)</li>
              <li>With trusted service providers under strict confidentiality agreements</li>
            </ul>
          </section>

          {/* Your Rights */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Your Rights</h2>
            <p className="text-gray-700 mb-4">You have the following rights regarding your data:</p>
            <ul className="list-disc pl-6 text-gray-700 space-y-2">
              <li><strong>Access:</strong> Request access to your personal data</li>
              <li><strong>Correction:</strong> Request correction of inaccurate data</li>
              <li><strong>Deletion:</strong> Request deletion of your data (subject to legal requirements)</li>
              <li><strong>Portability:</strong> Request a copy of your data in a portable format</li>
              <li><strong>Restriction:</strong> Request restriction of processing under certain circumstances</li>
              <li><strong>Withdrawal:</strong> Withdraw consent for data processing at any time</li>
            </ul>
          </section>

          {/* Data Retention */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Data Retention</h2>
            <p className="text-gray-700">
              We retain your data only as long as necessary to provide our services or as required by law. 
              When you delete your account, we will delete your personal data within 30 days, except where 
              we are required to retain it for legal or regulatory purposes.
            </p>
          </section>

          {/* Children's Privacy */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Children's Privacy</h2>
            <p className="text-gray-700">
              Our service is not intended for individuals under 18 years of age. We do not knowingly collect 
              personal information from children under 18. If we become aware that we have collected such 
              information, we will take steps to delete it promptly.
            </p>
          </section>

          {/* Changes to This Policy */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Changes to This Privacy Policy</h2>
            <p className="text-gray-700">
              We may update this Privacy Policy from time to time. We will notify you of any material changes 
              by posting the new policy on this page and updating the "Last Updated" date. We encourage you to 
              review this Privacy Policy periodically.
            </p>
          </section>

          {/* Contact Information */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Contact Us</h2>
            <p className="text-gray-700 mb-4">
              If you have any questions about this Privacy Policy or our data practices, please contact us at:
            </p>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-gray-700">
                <strong>Email:</strong> privacy@cardcycle.app<br />
                <strong>Website:</strong> cardcycle.app
              </p>
            </div>
          </section>

          {/* Footer */}
          <div className="border-t pt-6 text-center">
            <p className="text-gray-500 text-sm">
              This privacy policy is effective as of {new Date().toLocaleDateString()} and applies to all users of CardCycle.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}