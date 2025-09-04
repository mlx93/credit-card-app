'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Trash2, AlertTriangle, Shield, Database, Clock } from 'lucide-react';
import { ConfirmationDialog } from './ConfirmationDialog';

interface AccountSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
}

export function AccountSettings({ isOpen, onClose, userEmail }: AccountSettingsProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionStep, setDeletionStep] = useState('');

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeletionStep('Preparing account deletion...');

    try {
      setDeletionStep('Disconnecting from banks...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause

      setDeletionStep('Deleting transaction history...');
      await new Promise(resolve => setTimeout(resolve, 1500)); // Brief pause

      setDeletionStep('Removing all account data...');
      
      const response = await fetch('/api/user/delete-account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete account');
      }

      setDeletionStep('Account deleted successfully!');
      console.log('🎯 Account deletion completed:', data.deletionSummary);

      // Sign out and redirect after successful deletion
      setTimeout(async () => {
        await signOut({ callbackUrl: '/?deleted=true' });
      }, 2000);

    } catch (error) {
      console.error('Error deleting account:', error);
      setDeletionStep('');
      setIsDeleting(false);
      alert('Failed to delete account. Please try again or contact support.');
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <Shield className="h-6 w-6 text-blue-600" />
              <h2 className="text-xl font-semibold text-gray-900">Account Settings</h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <div className="w-6 h-6 flex items-center justify-center">×</div>
            </button>
          </div>

          {/* User Info */}
          <div className="bg-blue-50 rounded-lg p-4 mb-6">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
                {userEmail?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div>
                <p className="font-medium text-gray-900">Signed in as</p>
                <p className="text-sm text-gray-600">{userEmail}</p>
              </div>
            </div>
          </div>

          {/* Data Information */}
          <div className="space-y-4 mb-8">
            <h3 className="font-semibold text-gray-900 flex items-center">
              <Database className="h-4 w-4 mr-2" />
              Your Data
            </h3>
            <div className="bg-gray-50 rounded-lg p-4 space-y-3 text-sm text-gray-700">
              <div className="flex items-center">
                <Clock className="h-4 w-4 mr-2 text-green-600" />
                <span>We accumulate your transaction history over time for better analytics</span>
              </div>
              <div className="flex items-center">
                <Shield className="h-4 w-4 mr-2 text-blue-600" />
                <span>All data is encrypted and stored securely</span>
              </div>
              <div className="flex items-center">
                <Trash2 className="h-4 w-4 mr-2 text-red-600" />
                <span>You can delete your account and all data at any time</span>
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="border-2 border-red-100 rounded-lg p-4">
            <h3 className="font-semibold text-red-900 flex items-center mb-3">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Danger Zone
            </h3>
            <p className="text-sm text-red-700 mb-4">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isDeleting}
              className={`w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-lg font-medium transition-colors ${
                isDeleting
                  ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                  : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
            >
              <Trash2 className="h-4 w-4" />
              <span>{isDeleting ? deletionStep || 'Deleting Account...' : 'Delete My Account'}</span>
            </button>
          </div>

          {/* Close Button */}
          <div className="mt-6 pt-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        title="Delete Account Permanently?"
        message={`Are you sure you want to delete your account? This will permanently remove:

• All connected credit cards and bank connections
• Complete transaction history (including historical data)
• All billing cycles and payment tracking
• Account preferences and settings

This action cannot be undone. You will be signed out immediately.`}
        confirmText="Yes, Delete My Account"
        cancelText="Cancel"
        onConfirm={() => {
          setShowDeleteConfirm(false);
          handleDeleteAccount();
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        type="danger"
      />
    </>
  );
}