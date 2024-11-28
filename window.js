import { 
  signInWithCredential, 
  GoogleAuthProvider 
} from 'firebase/auth/web-extension';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  onSnapshot 
} from 'firebase/firestore';

import { auth, db } from './firebase-init.js';

document.addEventListener('DOMContentLoaded', async function() {
  const container = document.querySelector('.container');

  const PRICE_ID = 'price_YOUR_PRICE_ID_HERE';  // Replace with your actual price ID

  // Function to check if user has paid
  async function checkPaymentStatus(userId) {
    try {
      console.log('Checking payment status for userId:', userId);

      // First check in customers/{userId}/payments
      const paymentsRef = collection(db, 'customers', userId, 'payments');
      const querySnapshot = await getDocs(paymentsRef);
      console.log('Customer payments found:', querySnapshot.size);
      
      // Check each payment document
      for (const doc of querySnapshot.docs) {
        const paymentData = doc.data();
        console.log('Payment data found:', paymentData);
        // Note: Check both number and string representations of amount
        if ((paymentData.amount === 1000 || paymentData.amount === '1000') && 
            paymentData.currency === 'usd') {
          console.log('Valid payment found in customer payments');
          return true;
        }
      }

      // Check in root payments collection
      const rootPaymentsRef = collection(db, 'payments');
      const rootQuery = query(rootPaymentsRef, 
        where('customer', '==', userId)
      );
      const rootSnapshot = await getDocs(rootQuery);
      console.log('Root payments found:', rootSnapshot.size);

      // Check each root payment document
      for (const doc of rootSnapshot.docs) {
        const paymentData = doc.data();
        console.log('Root payment data found:', paymentData);
        // Note: Check both number and string representations of amount
        if ((paymentData.amount === 1000 || paymentData.amount === '1000') && 
            paymentData.currency === 'eur') {
          console.log('Valid payment found in root payments');
          return true;
        }
      }

      console.log('No valid payments found');
      return false;

    } catch (error) {
      console.error('Error checking payment status:', error);
      if (error.code === 'permission-denied') {
        console.log('Permission denied when checking payments');
        return false;
      }
      throw error;
    }
  }

  // Add this function to remove cached token
  function removeCachedToken(callback) {
    chrome.identity.getAuthToken({ interactive: false }, function(token) {
      if (!chrome.runtime.lastError && token) {
        // Remove token from cache
        chrome.identity.removeCachedAuthToken({ token: token }, function() {
          callback();
        });
      } else {
        callback();
      }
    });
  }

  chrome.identity.getProfileUserInfo(function(userInfo) {
    if (!userInfo.email) {
      container.innerHTML = `
        <h2>Error</h2>
        <p>Please make sure you're signed into Chrome and sync is enabled.</p>
      `;
      return;
    }

    // Modify the auth token request to handle invalid tokens
    function getAuthTokenAndSignIn() {
      chrome.identity.getAuthToken({ interactive: true }, async function(token) {
        if (chrome.runtime.lastError) {
          console.error('Auth Token Error:', chrome.runtime.lastError);
          container.innerHTML = `
            <h2>Error</h2>
            <p>Authentication Error: ${chrome.runtime.lastError.message}</p>
          `;
          return;
        }

        const credential = GoogleAuthProvider.credential(null, token);
        try {
          const userCredential = await signInWithCredential(auth, credential);
          const user = userCredential.user;
          
          // Check if user has already paid
          const hasPaid = await checkPaymentStatus(user.uid);
          console.log('User ID:', user.uid);
          console.log('Payment status result:', hasPaid);
          
          if (hasPaid) {
            container.innerHTML = `
              <h2>Thank You!</h2>
              <p>Your payment of $10.00 has been received.</p>
              <p>Signed in as: ${user.email}</p>
              <p>Firebase UID: ${user.uid}</p>
            `;
            return;
          }
          
          container.innerHTML = `
            <h2>Make a Donation</h2>
            <p>Signed in as: ${user.email}</p>
            <p>Firebase UID: ${user.uid}</p>
            <button id="donateButton">Donate Now</button>
          `;

          // Store the donate button click handler separately so we can reuse it
          const handleDonateClick = async function() {
            try {
              const donateButton = document.getElementById('donateButton');
              donateButton.disabled = true;
              donateButton.textContent = 'Processing...';

              const checkoutSessionRef = collection(
                db,
                'customers',
                user.uid,
                'checkout_sessions'
              );

              const sessionData = {
                price: PRICE_ID,
                success_url: 'https://example.com/success',
                cancel_url: 'https://example.com/cancel',
                mode: 'payment',
                metadata: {
                  userId: user.uid,
                  userEmail: user.email
                }
              };

              console.log('Creating checkout session...');
              const docRef = await addDoc(checkoutSessionRef, sessionData);
              console.log('Checkout session created:', docRef.id);

              const unsubscribe = onSnapshot(docRef, (snap) => {
                const data = snap.data();
                console.log('Session data:', data);

                if (data?.error) {
                  console.error('Checkout error:', data.error);
                  container.innerHTML = `
                    <h2>Error</h2>
                    <p>${data.error.message || 'An error occurred'}</p>
                    <button id="retryButton">Try Again</button>
                  `;
                  unsubscribe();
                }
                
                if (data?.url) {
                  console.log('Payment URL available:', data.url);
                  container.innerHTML = `
                    <h2>Payment Instructions</h2>
                    <p>You will be redirected to the payment page.</p>
                    <p>After completing the payment, please close this window and open the extension again to see your payment status.</p>
                    <div style="display: flex; gap: 10px; margin-top: 20px;">
                      <button id="cancelButton" style="background-color: #dc3545;">Cancel</button>
                      <button id="proceedButton" style="background-color: #28a745;">Proceed to Payment</button>
                    </div>
                  `;

                  // Handle Cancel button
                  const cancelButton = document.getElementById('cancelButton');
                  cancelButton.addEventListener('click', () => {
                    // Reset to initial donation screen
                    container.innerHTML = `
                      <h2>Make a Donation</h2>
                      <p>Signed in as: ${user.email}</p>
                      <p>Firebase UID: ${user.uid}</p>
                      <button id="donateButton">Donate Now</button>
                    `;
                    // Reattach the donate button event listener to the new button
                    const newDonateButton = document.getElementById('donateButton');
                    newDonateButton.addEventListener('click', handleDonateClick);
                  });

                  // Handle Proceed button
                  const proceedButton = document.getElementById('proceedButton');
                  proceedButton.addEventListener('click', () => {
                    window.location.href = data.url;
                  });

                  unsubscribe();
                }
              });

            } catch (error) {
              console.error('Payment Setup Error:', error);
              container.innerHTML = `
                <h2>Error</h2>
                <p>Failed to setup payment: ${error.message}</p>
                <button id="retryButton">Try Again</button>
              `;
              
              const retryButton = document.getElementById('retryButton');
              retryButton.addEventListener('click', () => {
                window.location.reload();
              });
            }
          };

          // Initial setup of donate button
          const donateButton = document.getElementById('donateButton');
          donateButton.addEventListener('click', handleDonateClick);

        } catch (error) {
          console.error('Firebase Auth Error:', error);
          if (error.code === 'auth/invalid-credential') {
            // If token is invalid, remove it and try again
            removeCachedToken(() => {
              getAuthTokenAndSignIn(); // Retry authentication
            });
          } else {
            container.innerHTML = `
              <h2>Error</h2>
              <p>Failed to authenticate with Firebase: ${error.message}</p>
            `;
          }
        }
      });
    }

    // Start the authentication process
    getAuthTokenAndSignIn();
  });
}); 