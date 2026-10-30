// ----------------------------------------------------------------------------
//  OPTIONAL: control your PC from ANYWHERE (not just your home Wi-Fi).
//
//  Without this file, Troll Remote works great over your local Wi-Fi using the
//  QR code / 6-letter code. Set this up only if you want to sign in with an
//  account and have it work over the internet.
//
//  SETUP (about 5 minutes, free):
//   1. Go to https://console.firebase.google.com and click "Add project".
//   2. In the project, open  Build > Authentication > Get started, and enable
//      the "Email/Password" sign-in method.
//   3. Open  Build > Firestore Database > Create database  (Production mode).
//      Then in the Rules tab, paste the rules from README.md and Publish.
//   4. Open  Project settings (gear icon) > General, scroll to "Your apps",
//      click the web icon  </>  , register an app, and copy the config values
//      it shows you into the object below.
//   5. Back in Authentication > Users, click "Add user" and create one login
//      (an email + password). You'll type that same login on the PC and on the
//      iPad — that's what pairs them. Share it only with yourself.
//   6. Save this file as  firebase-config.js  (same folder, drop ".example").
//   7. Restart Troll Remote. A "Sign in" option appears in the window and on
//      the iPad page.
//
//  These values are NOT secret (they're meant to ship in web apps); your data
//  is protected by the Firestore rules + your account password.
// ----------------------------------------------------------------------------

window.FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:xxxxxxxxxxxxxxxx',
};

// Which version of the Firebase web SDK to load from Google's CDN. Bump this
// if you ever need a newer one.
window.FIREBASE_SDK_VERSION = '10.14.1';
