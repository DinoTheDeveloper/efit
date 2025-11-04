import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  arrayUnion,
  query,
  where,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';

// 🔥 FIREBASE CONFIGURATION
// Replace this with your Firebase config from Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyBavLlGxkv-LqfCr43fOM1JQYpCVkbXTmQ",
  authDomain: "day-challenge-9a759.firebaseapp.com",
  projectId: "day-challenge-9a759",
  storageBucket: "day-challenge-9a759.firebasestorage.app",
  messagingSenderId: "946833002713",
  appId: "1:946833002713:web:6b6690b0a79813d885aec8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Firebase Service Functions
const FirebaseService = {
  signIn: async (email, password) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await setDoc(doc(db, 'users', user.uid), {
          name: email.split('@')[0],
          email: user.email,
          groupCode: null,
          currentDay: 0,
          streak: 0,
          badges: [],
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          createdAt: serverTimestamp()
        });

        return user;
      }
      throw error;
    }
  },

  signOut: () => firebaseSignOut(auth),

  createGroup: async (userId, groupName) => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    await setDoc(doc(db, 'groups', code), {
      name: groupName,
      members: [userId],
      createdAt: serverTimestamp()
    });

    await updateDoc(doc(db, 'users', userId), {
      groupCode: code
    });

    return code;
  },

  joinGroup: async (userId, code) => {
    const groupRef = doc(db, 'groups', code);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      return false;
    }

    await updateDoc(groupRef, {
      members: arrayUnion(userId)
    });

    await updateDoc(doc(db, 'users', userId), {
      groupCode: code
    });

    return true;
  },

  saveCheckIn: async (userId, day, checkInData, photoBase64, videoBase64) => {
    await setDoc(doc(db, 'users', userId, 'checkIns', day.toString()), {
      ...checkInData,
      photoUrl: photoBase64 || null,
      photoIsPublic: false,
      videoUrl: videoBase64 || null,
      timestamp: serverTimestamp()
    });

    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();

    const allComplete = Object.values(checkInData).every(v => v === true);
    const newStreak = allComplete ? (userData.streak || 0) + 1 : userData.streak || 0;

    await updateDoc(userRef, {
      currentDay: day,
      streak: newStreak
    });

    await FirebaseService.checkAndAwardBadges(userId, day, newStreak);

    const groupCode = userData.groupCode;
    if (groupCode) {
      await setDoc(doc(db, 'groups', groupCode, 'feed', `${userId}_${day}`), {
        userId,
        day,
        timestamp: serverTimestamp(),
        type: 'checkin'
      });
    }
  },

  checkAndAwardBadges: async (userId, day, streak) => {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();
    const badges = userData.badges || [];

    let newBadges = [...badges];

    if (day >= 7 && !badges.includes('week-warrior')) {
      newBadges.push('week-warrior');
    }
    if (day >= 30 && !badges.includes('30-day-hero')) {
      newBadges.push('30-day-hero');
    }
    if (day >= 75 && !badges.includes('completed-75')) {
      newBadges.push('completed-75');
    }
    if (streak >= 10 && !badges.includes('streak-master')) {
      newBadges.push('streak-master');
    }

    if (newBadges.length > badges.length) {
      await updateDoc(userRef, { badges: newBadges });
    }
  },

  togglePhotoVisibility: async (userId, day) => {
    const checkInRef = doc(db, 'users', userId, 'checkIns', day.toString());
    const checkInSnap = await getDoc(checkInRef);

    if (checkInSnap.exists()) {
      const currentVisibility = checkInSnap.data().photoIsPublic || false;
      await updateDoc(checkInRef, {
        photoIsPublic: !currentVisibility
      });
    }
  },

  addReaction: async (userId, targetUserId, day, emoji) => {
    const reactionRef = doc(db, 'reactions', `${targetUserId}_${day}_${userId}`);
    const reactionSnap = await getDoc(reactionRef);

    if (reactionSnap.exists() && reactionSnap.data().emoji === emoji) {
      await setDoc(reactionRef, { deleted: true });
    } else {
      await setDoc(reactionRef, {
        userId,
        targetUserId,
        day,
        emoji,
        timestamp: serverTimestamp()
      });
    }
  },

  getReactions: async (targetUserId, day) => {
    const reactionsQuery = query(
      collection(db, 'reactions'),
      where('targetUserId', '==', targetUserId),
      where('day', '==', day)
    );

    const snapshot = await getDocs(reactionsQuery);
    return snapshot.docs
      .map(doc => doc.data())
      .filter(r => !r.deleted);
  },

  getUserData: async (userId) => {
    const userSnap = await getDoc(doc(db, 'users', userId));
    if (!userSnap.exists()) return null;

    const userData = userSnap.data();

    const checkInsSnap = await getDocs(collection(db, 'users', userId, 'checkIns'));
    const checkIns = {};
    const photos = {};
    const videos = {};

    checkInsSnap.forEach(doc => {
      const data = doc.data();
      checkIns[doc.id] = data;

      if (data.photoUrl) {
        photos[doc.id] = {
          url: data.photoUrl,
          timestamp: data.timestamp,
          isPublic: data.photoIsPublic || false
        };
      }

      if (data.videoUrl) {
        videos[doc.id] = {
          url: data.videoUrl,
          timestamp: data.timestamp
        };
      }
    });

    return {
      ...userData,
      checkIns,
      photos,
      videos
    };
  },

  getGroupData: async (groupCode) => {
    const groupSnap = await getDoc(doc(db, 'groups', groupCode));
    if (!groupSnap.exists()) return null;
    return groupSnap.data();
  },

  getGroupFeed: async (groupCode) => {
    const feedSnap = await getDocs(collection(db, 'groups', groupCode, 'feed'));
    return feedSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
  },

  leaveGroup: async (userId, groupCode) => {
    const groupRef = doc(db, 'groups', groupCode);
    const groupSnap = await getDoc(groupRef);

    if (groupSnap.exists()) {
      const members = groupSnap.data().members.filter(id => id !== userId);
      await updateDoc(groupRef, { members });
    }

    await updateDoc(doc(db, 'users', userId), {
      groupCode: null
    });
  }
};

// UI Components
const CupertinoButton = ({ children, onClick, primary, disabled, fullWidth }) => (
  <button onClick={onClick} disabled={disabled} style={{
    backgroundColor: primary ? '#007AFF' : 'transparent',
    color: primary ? 'white' : '#007AFF',
    border: primary ? 'none' : '1px solid #007AFF',
    borderRadius: '12px',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: '500',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    width: fullWidth ? '100%' : 'auto',
    transition: 'all 0.2s ease'
  }}>
    {children}
  </button>
);

const CupertinoToggle = ({ value, onChange, label }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
    <span style={{ fontSize: '16px', color: '#333' }}>{label}</span>
    <div onClick={() => onChange(!value)} style={{
      width: '51px',
      height: '31px',
      backgroundColor: value ? '#34C759' : '#E5E5EA',
      borderRadius: '16px',
      position: 'relative',
      cursor: 'pointer',
      transition: 'background-color 0.3s ease'
    }}>
      <div style={{
        width: '27px',
        height: '27px',
        backgroundColor: 'white',
        borderRadius: '50%',
        position: 'absolute',
        top: '2px',
        left: value ? '22px' : '2px',
        transition: 'left 0.3s ease',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
      }} />
    </div>
  </div>
);

const CupertinoCard = ({ children, style }) => (
  <div style={{
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '20px',
    marginBottom: '16px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    ...style
  }}>
    {children}
  </div>
);

const Badge = ({ type, size = 'medium' }) => {
  const badges = {
    'week-warrior': { emoji: '⚡', name: 'Week Warrior', color: '#FF9500' },
    '30-day-hero': { emoji: '🏆', name: '30 Day Hero', color: '#FF2D55' },
    'completed-75': { emoji: '👑', name: 'Champion', color: '#FFD700' },
    'streak-master': { emoji: '🔥', name: 'Streak Master', color: '#FF3B30' }
  };

  const badge = badges[type];
  if (!badge) return null;

  const dimensions = size === 'small' ? '40px' : size === 'large' ? '80px' : '60px';
  const fontSize = size === 'small' ? '20px' : size === 'large' ? '40px' : '30px';

  return (
    <div style={{ textAlign: 'center', display: 'inline-block', margin: '8px' }}>
      <div style={{
        width: dimensions,
        height: dimensions,
        borderRadius: '50%',
        backgroundColor: badge.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: fontSize,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        margin: '0 auto 4px'
      }}>
        {badge.emoji}
      </div>
      <div style={{ fontSize: size === 'small' ? '10px' : '12px', color: '#8E8E93', fontWeight: '600' }}>
        {badge.name}
      </div>
    </div>
  );
};

const ProgressBar = ({ progress, max }) => {
  const percentage = (progress / max) * 100;
  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{
        width: '100%',
        height: '8px',
        backgroundColor: '#E5E5EA',
        borderRadius: '4px',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${percentage}%`,
          height: '100%',
          backgroundColor: '#34C759',
          borderRadius: '4px',
          transition: 'width 0.3s ease'
        }} />
      </div>
      <div style={{
        marginTop: '4px',
        fontSize: '12px',
        color: '#8E8E93',
        textAlign: 'right'
      }}>
        Day {progress}/75
      </div>
    </div>
  );
};

const LoadingScreen = () => (
  <div style={{
    minHeight: '100vh',
    backgroundColor: '#F2F2F7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
  }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>💪</div>
      <div style={{ fontSize: '18px', color: '#8E8E93' }}>Loading...</div>
    </div>
  </div>
);

// Main App
export default function App() {
  const [currentScreen, setCurrentScreen] = useState('auth');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [userData, setUserData] = useState(null);
  const [groupData, setGroupData] = useState(null);
  const [groupFeed, setGroupFeed] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [todayCheckIn, setTodayCheckIn] = useState({
    workoutsDone: false,
    followedDiet: false,
    noAlcohol: false,
    readTenPages: false,
    tookPhoto: false
  });
  const [photoPreview, setPhotoPreview] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        await loadUserData(firebaseUser.uid);
      } else {
        setUser(null);
        setUserData(null);
        setGroupData(null);
        setCurrentScreen('auth');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loadUserData = async (userId) => {
    try {
      const data = await FirebaseService.getUserData(userId);
      setUserData(data);

      if (data?.groupCode) {
        const group = await FirebaseService.getGroupData(data.groupCode);
        const feed = await FirebaseService.getGroupFeed(data.groupCode);
        setGroupData(group);
        setGroupFeed(feed);

        const members = await Promise.all(
          group.members.map(uid => FirebaseService.getUserData(uid))
        );
        setGroupMembers(members);

        setCurrentScreen('dashboard');
      } else {
        setCurrentScreen('group');
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const refreshData = async () => {
    if (user) {
      await loadUserData(user.uid);
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (currentScreen === 'auth') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#F2F2F7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
        <div style={{ maxWidth: '400px', margin: '0 auto', padding: '40px 20px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: '700', textAlign: 'center', marginBottom: '40px', color: '#333' }}>
            75 Day Challenge
          </h1>
          <CupertinoCard>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: '12px', marginBottom: '12px', border: '1px solid #E5E5EA', borderRadius: '8px', fontSize: '16px', boxSizing: 'border-box' }}
            />
            <input
              type="password"
              placeholder="Password (min 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: '12px', marginBottom: '20px', border: '1px solid #E5E5EA', borderRadius: '8px', fontSize: '16px', boxSizing: 'border-box' }}
            />
            {authError && (
              <div style={{ color: '#FF3B30', fontSize: '14px', marginBottom: '12px' }}>
                {authError}
              </div>
            )}
            <CupertinoButton primary fullWidth onClick={async () => {
              try {
                setAuthError('');
                setLoading(true);
                await FirebaseService.signIn(email, password);
              } catch (error) {
                setAuthError(error.message);
                setLoading(false);
              }
            }}>
              Sign In / Sign Up
            </CupertinoButton>
          </CupertinoCard>
          <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: '14px', marginTop: '20px' }}>
            Enter email & password to sign in or create account
          </p>
        </div>
      </div>
    );
  }

  if (currentScreen === 'group') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#F2F2F7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
        <div style={{ maxWidth: '500px', margin: '0 auto', padding: '40px 20px' }}>
          <h2 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '24px', color: '#333' }}>
            Join or Create a Group
          </h2>

          <CupertinoCard>
            <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', color: '#333' }}>
              Create New Group
            </h3>
            <input
              type="text"
              placeholder="Group Name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              style={{ width: '100%', padding: '12px', marginBottom: '16px', border: '1px solid #E5E5EA', borderRadius: '8px', fontSize: '16px', boxSizing: 'border-box' }}
            />
            <CupertinoButton primary fullWidth disabled={!groupName.trim() || loading} onClick={async () => {
              if (groupName.trim()) {
                setLoading(true);
                await FirebaseService.createGroup(user.uid, groupName);
                setGroupName('');
                await refreshData();
                setLoading(false);
              }
            }}>
              Create Group
            </CupertinoButton>
          </CupertinoCard>

          <div style={{ textAlign: 'center', margin: '20px 0', color: '#8E8E93', fontWeight: '600' }}>OR</div>

          <CupertinoCard>
            <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', color: '#333' }}>
              Join Existing Group
            </h3>
            <input
              type="text"
              placeholder="6-Character Code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              style={{ width: '100%', padding: '12px', marginBottom: '16px', border: '1px solid #E5E5EA', borderRadius: '8px', fontSize: '16px', textTransform: 'uppercase', boxSizing: 'border-box' }}
            />
            <CupertinoButton primary fullWidth disabled={joinCode.length !== 6 || loading} onClick={async () => {
              setLoading(true);
              const success = await FirebaseService.joinGroup(user.uid, joinCode);
              if (success) {
                setJoinCode('');
                await refreshData();
              } else {
                alert('Invalid code. Please try again.');
              }
              setLoading(false);
            }}>
              Join Group
            </CupertinoButton>
          </CupertinoCard>
        </div>
      </div>
    );
  }

  if (currentScreen === 'checkin') {
    const nextDay = (userData?.currentDay || 0) + 1;
    const allChecked = Object.values(todayCheckIn).every(v => v);

    const now = new Date();
    const userDate = new Date(now.toLocaleString('en-US', { timeZone: userData?.timezone || 'UTC' }));
    const midnight = new Date(userDate);
    midnight.setHours(24, 0, 0, 0);
    const hoursUntilMidnight = Math.floor((midnight - userDate) / (1000 * 60 * 60));
    const minutesUntilMidnight = Math.floor(((midnight - userDate) % (1000 * 60 * 60)) / (1000 * 60));

    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#F2F2F7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
        <div style={{ maxWidth: '500px', margin: '0 auto', padding: '40px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: '700', color: '#333' }}>Day {nextDay} Check-In</h2>
            <button onClick={() => { setCurrentScreen('dashboard'); setPhotoPreview(null); setVideoPreview(null); }} style={{ background: 'none', border: 'none', color: '#007AFF', fontSize: '16px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>

          {hoursUntilMidnight < 3 && (
            <div style={{ backgroundColor: '#FF3B30', color: 'white', padding: '12px', borderRadius: '12px', marginBottom: '16px', textAlign: 'center', fontWeight: '600' }}>
              ⏰ Complete before midnight! {hoursUntilMidnight}h {minutesUntilMidnight}m remaining
            </div>
          )}

          <CupertinoCard>
            <CupertinoToggle label="✓ Two workouts completed" value={todayCheckIn.workoutsDone} onChange={(v) => setTodayCheckIn({ ...todayCheckIn, workoutsDone: v })} />
            <div style={{ height: '1px', backgroundColor: '#E5E5EA', margin: '8px 0' }} />
            <CupertinoToggle label="✓ Followed diet plan" value={todayCheckIn.followedDiet} onChange={(v) => setTodayCheckIn({ ...todayCheckIn, followedDiet: v })} />
            <div style={{ height: '1px', backgroundColor: '#E5E5EA', margin: '8px 0' }} />
            <CupertinoToggle label="✓ No alcohol or cheat meals" value={todayCheckIn.noAlcohol} onChange={(v) => setTodayCheckIn({ ...todayCheckIn, noAlcohol: v })} />
            <div style={{ height: '1px', backgroundColor: '#E5E5EA', margin: '8px 0' }} />
            <CupertinoToggle label="✓ Read 10 pages" value={todayCheckIn.readTenPages} onChange={(v) => setTodayCheckIn({ ...todayCheckIn, readTenPages: v })} />
            <div style={{ height: '1px', backgroundColor: '#E5E5EA', margin: '8px 0' }} />
            <CupertinoToggle label="✓ Took progress photo" value={todayCheckIn.tookPhoto} onChange={(v) => setTodayCheckIn({ ...todayCheckIn, tookPhoto: v })} />
          </CupertinoCard>

          <CupertinoCard>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#333' }}>Progress Photo</h3>
            <input type="file" accept="image/*" onChange={(e) => {
              const file = e.target.files[0];
              if (file) {
                const reader = new FileReader();
                reader.onloadend = () => setPhotoPreview(reader.result);
                reader.readAsDataURL(file);
              }
            }} style={{ marginBottom: '12px' }} />
            {photoPreview && <img src={photoPreview} alt="Preview" style={{ width: '100%', borderRadius: '12px', marginTop: '12px' }} />}
            <p style={{ fontSize: '12px', color: '#8E8E93', marginTop: '8px' }}>Optional: Upload your progress photo for today</p>
          </CupertinoCard>

          <CupertinoCard>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#333' }}>Video Check-In (Optional)</h3>
            <input type="file" accept="video/*" onChange={(e) => {
              const file = e.target.files[0];
              if (file) {
                const reader = new FileReader();
                reader.onloadend = () => setVideoPreview(reader.result);
                reader.readAsDataURL(file);
              }
            }} style={{ marginBottom: '12px' }} />
            {videoPreview && <video src={videoPreview} controls style={{ width: '100%', borderRadius: '12px', marginTop: '12px' }} />}
            <p style={{ fontSize: '12px', color: '#8E8E93', marginTop: '8px' }}>Record a quick video for extra accountability!</p>
          </CupertinoCard>

          <CupertinoButton primary fullWidth disabled={!allChecked || loading} onClick={async () => {
            setLoading(true);
            const oldBadgeCount = userData?.badges?.length || 0;

            await FirebaseService.saveCheckIn(user.uid, nextDay, todayCheckIn, photoPreview, videoPreview);

            setTodayCheckIn({ workoutsDone: false, followedDiet: false, noAlcohol: false, readTenPages: false, tookPhoto: false });
            setPhotoPreview(null);
            setVideoPreview(null);

            await refreshData();
            setLoading(false);

            const newUserData = await FirebaseService.getUserData(user.uid);
            if (newUserData.badges.length > oldBadgeCount) {
              alert('🎉 New badge unlocked! Check your profile!');
            } else {
              alert('Great job! Day completed! 🎉');
            }
            setCurrentScreen('dashboard');
          }}>
            {allChecked ? 'Complete Day' : 'Complete all tasks to continue'}
          </CupertinoButton>
        </div>
      </div>
    );
  }

  if (currentScreen === 'dashboard') {
    const quotes = [
      "The only way to do great work is to love what you do.",
      "Success is not final, failure is not fatal: it is the courage to continue that counts.",
      "Believe you can and you're halfway there.",
      "The future depends on what you do today.",
      "Don't watch the clock; do what it does. Keep going."
    ];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#F2F2F7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', padding: '20px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: '700', color: '#333', margin: 0 }}>{groupData?.name || 'Dashboard'}</h2>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <CupertinoButton onClick={() => setShowCalendar(!showCalendar)}>{showCalendar ? 'Hide' : 'Calendar'}</CupertinoButton>
              <CupertinoButton onClick={() => setCurrentScreen('photos')}>Photos</CupertinoButton>
              <CupertinoButton onClick={() => setCurrentScreen('feed')}>Feed</CupertinoButton>
              <CupertinoButton onClick={() => setCurrentScreen('profile')}>Profile</CupertinoButton>
              <CupertinoButton primary onClick={() => setCurrentScreen('checkin')}>Daily Check-In</CupertinoButton>
            </div>
          </div>

          {userData && (
            <CupertinoCard style={{ backgroundColor: '#007AFF', color: 'white' }}>
              <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>Your Progress</div>
              <div style={{ fontSize: '32px', fontWeight: '700', marginBottom: '4px' }}>Day {userData.currentDay}/75</div>
              <div style={{ fontSize: '16px', opacity: 0.9 }}>🔥 {userData.streak} day streak</div>
              <ProgressBar progress={userData.currentDay} max={75} />
              {userData.badges && userData.badges.length > 0 && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                  <div style={{ fontSize: '14px', marginBottom: '8px', opacity: 0.9 }}>Your Badges:</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {userData.badges.map(badge => <Badge key={badge} type={badge} size="small" />)}
                  </div>
                </div>
              )}
            </CupertinoCard>
          )}

          {showCalendar && (
            <CupertinoCard>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#333' }}>75-Day Calendar</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: '8px' }}>
                {Array.from({ length: 75 }, (_, i) => i + 1).map(day => {
                  const isComplete = userData?.checkIns?.[day];
                  const isCurrent = day === userData?.currentDay;
                  const isFuture = day > (userData?.currentDay || 0);
                  return (
                    <div key={day} style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                      fontWeight: isCurrent ? '700' : '500',
                      backgroundColor: isComplete ? '#34C759' : isFuture ? '#F2F2F7' : '#FF3B30',
                      color: isComplete || !isFuture ? 'white' : '#8E8E93',
                      border: isCurrent ? '2px solid #007AFF' : 'none',
                      cursor: 'pointer'
                    }}>
                      {isComplete ? '✓' : day}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: '16px', display: 'flex', gap: '16px', fontSize: '12px', color: '#8E8E93' }}>
                <div><span style={{ color: '#34C759' }}>●</span> Complete</div>
                <div><span style={{ color: '#FF3B30' }}>●</span> Incomplete</div>
                <div><span style={{ color: '#8E8E93' }}>●</span> Future</div>
              </div>
            </CupertinoCard>
          )}

          <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', color: '#333' }}>Group Members ({groupMembers.length})</h3>

          {groupMembers.map((member) => (
            <CupertinoCard key={member.email}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: '600', color: '#333', marginBottom: '4px' }}>{member.name}</div>
                  <div style={{ fontSize: '14px', color: '#8E8E93' }}>{member.email}</div>
                  {member.badges && member.badges.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', gap: '4px' }}>
                      {member.badges.map(badge => <Badge key={badge} type={badge} size="small" />)}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#007AFF' }}>{member.currentDay}/75</div>
                  <div style={{ fontSize: '14px', color: '#8E8E93' }}>🔥 {member.streak} streak</div>
                </div>
              </div>
              <ProgressBar progress={member.currentDay} max={75} />
            </CupertinoCard>
          ))}

          <CupertinoCard style={{ backgroundColor: '#F2F2F7', textAlign: 'center', marginTop: '24px' }}>
            <div style={{ fontSize: '14px', color: '#8E8E93', marginBottom: '8px', fontWeight: '600' }}>💪 MOTIVATION</div>
            <div style={{ fontSize: '16px', color: '#333', fontStyle: 'italic' }}>"{randomQuote}"</div>
          </CupertinoCard>

          <div style={{ textAlign: 'center', marginTop: '24px', padding: '20px' }}>
            <div style={{ fontSize: '12px', color: '#8E8E93' }}>Group Code: <strong>{userData?.groupCode}</strong></div>
            <div style={{ fontSize: '12px', color: '#8E8E93', marginTop: '4px' }}>Share this code with friends to invite them</div>
          </div>
        </div>
      </div>
    );
  }

  if (currentScreen === 'photos') {
    const photos = userData?.photos || {};
    const photoKeys = Object.keys(photos).sort((a, b) => b - a);
    const firstPhoto = photos[Object.keys(photos)[0]];
    const latestPhoto = photos[userData?.currentDay];

    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#F2F2F7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', padding: '20px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: '700', color: '#333' }}>Progress Photos</h2>
            <button onClick={() => setCurrentScreen('dashboard')} style={{ background: 'none', border: 'none', color: '#007AFF', fontSize: '16px', cursor: 'pointer' }}>Done</button>
          </div>

          {firstPhoto && latestPhoto && (
            <CupertinoCard>
              <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', color: '#333' }}>Before & After</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '14px', color: '#8E8E93', marginBottom: '8px', fontWeight: '600' }}>Day 1</div>
                  <img src={firstPhoto.url} alt="Day 1" style={{ width: '100%', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} />
                </div>
                <div>
                  <div style={{ fontSize: '14px', color: '#8E8E93', marginBottom: '8px', fontWeight: '600' }}>Day {userData?.currentDay}</div>
                  <img src={latestPhoto.url} alt="Latest" style={{ width: '100%', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} />
                </div>
              </div>
            </CupertinoCard>
          )}

          <h3 style={{ fontSize: '20px', fontWeight: '600', margin: '24px 0 16px', color: '#333' }}>All Photos ({photoKeys.length})</h3>

          {photoKeys.length === 0 && (
            <CupertinoCard style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📸</div>
              <div style={{ fontSize: '16px', color: '#8E8E93' }}>No photos yet. Add one during your daily check-in!</div>
            </CupertinoCard>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
            {photoKeys.map(day => (
              <CupertinoCard key={day}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ fontSize: '16px', fontWeight: '600', color: '#333' }}>Day {day}</div>
                  <button onClick={async () => {
                    await FirebaseService.togglePhotoVisibility(user.uid, day);
                    await refreshData();
                  }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }} title={photos[day].isPublic ? 'Make private' : 'Share with group'}>
                    {photos[day].isPublic ? '🌍' : '🔒'}
                  </button>
                </div>
                <img src={photos[day].url} alt={`Day ${day}`} style={{ width: '100%', borderRadius: '12px', marginBottom: '8px' }} />
                <div style={{ fontSize: '12px', color: '#8E8E93' }}>{new Date(photos[day].timestamp?.seconds * 1000).toLocaleDateString()}</div>
              </CupertinoCard>
            ))}
          </div>

          <h3 style={{ fontSize: '20px', fontWeight: '600', margin: '24px 0 16px', color: '#333' }}>Group Members' Photos</h3>

          {groupMembers.map(member => {
            if (member.email === userData?.email) return null;
            const publicPhotos = Object.entries(member.photos || {}).filter(([_, photo]) => photo.isPublic).sort((a, b) => b[0] - a[0]);

            if (publicPhotos.length === 0) return null;

            return (
              <div key={member.email}>
                <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: '#333' }}>{member.name}'s Photos</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                  {publicPhotos.map(([day, photo]) => (
                    <div key={day}>
                      <img src={photo.url} alt={`${member.name} Day ${day}`} style={{ width: '100%', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} />
                      <div style={{ fontSize: '12px', color: '#8E8E93', marginTop: '4px', textAlign: 'center' }}>Day {day}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (currentScreen === 'feed') {
    const feed = groupFeed.slice(0, 20);

    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#F2F2F7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', padding: '20px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: '700', color: '#333' }}>Group Feed</h2>
            <button onClick={() => setCurrentScreen('dashboard')} style={{ background: 'none', border: 'none', color: '#007AFF', fontSize: '16px', cursor: 'pointer' }}>Done</button>
          </div>

          {feed.length === 0 && (
            <CupertinoCard style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎯</div>
              <div style={{ fontSize: '16px', color: '#8E8E93' }}>No activity yet. Complete your first check-in!</div>
            </CupertinoCard>
          )}

          {feed.map((item, index) => {
            const member = groupMembers[index % groupMembers.length] || {};

            return (
              <CupertinoCard key={`${item.userId}-${item.day}-${index}`}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '20px', backgroundColor: '#007AFF', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: '700', marginRight: '12px' }}>
                    {member.name?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: '600', color: '#333' }}>{member.name}</div>
                    <div style={{ fontSize: '12px', color: '#8E8E93' }}>Completed Day {item.day}</div>
                  </div>
                </div>

                <div style={{ fontSize: '14px', color: '#333', marginBottom: '12px' }}>✅ Crushed all 5 daily tasks! 💪</div>

                {member.photos?.[item.day]?.isPublic && <img src={member.photos[item.day].url} alt={`Day ${item.day}`} style={{ width: '100%', borderRadius: '12px', marginBottom: '12px' }} />}
              </CupertinoCard>
            );
          })}
        </div>
      </div>
    );
  }

  if (currentScreen === 'profile') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#F2F2F7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', padding: '40px 20px' }}>
        <div style={{ maxWidth: '500px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: '700', color: '#333' }}>Profile</h2>
            <button onClick={() => setCurrentScreen('dashboard')} style={{ background: 'none', border: 'none', color: '#007AFF', fontSize: '16px', cursor: 'pointer' }}>Done</button>
          </div>

          <CupertinoCard>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ width: '80px', height: '80px', borderRadius: '40px', backgroundColor: '#007AFF', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', fontWeight: '700', margin: '0 auto 12px' }}>
                {userData?.name?.charAt(0).toUpperCase()}
              </div>
              <div style={{ fontSize: '22px', fontWeight: '600', color: '#333' }}>{userData?.name}</div>
              <div style={{ fontSize: '14px', color: '#8E8E93', marginTop: '4px' }}>{userData?.email}</div>
              <div style={{ fontSize: '12px', color: '#8E8E93', marginTop: '4px' }}>🌍 Timezone: {userData?.timezone}</div>
            </div>

            <div style={{ borderTop: '1px solid #E5E5EA', paddingTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#007AFF' }}>{userData?.currentDay}</div>
                  <div style={{ fontSize: '14px', color: '#8E8E93' }}>Days Complete</div>
                </div>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#34C759' }}>{userData?.streak}</div>
                  <div style={{ fontSize: '14px', color: '#8E8E93' }}>Current Streak</div>
                </div>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#FF9500' }}>{75 - (userData?.currentDay || 0)}</div>
                  <div style={{ fontSize: '14px', color: '#8E8E93' }}>Days Left</div>
                </div>
              </div>
            </div>
          </CupertinoCard>

          {userData?.badges && userData.badges.length > 0 ? (
            <CupertinoCard>
              <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', color: '#333', textAlign: 'center' }}>🏆 Your Badges ({userData.badges.length})</h3>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
                {userData.badges.map(badge => <Badge key={badge} type={badge} size="large" />)}
              </div>
            </CupertinoCard>
          ) : (
            <CupertinoCard style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏆</div>
              <div style={{ fontSize: '16px', color: '#8E8E93', marginBottom: '8px' }}>No badges yet!</div>
              <div style={{ fontSize: '14px', color: '#8E8E93' }}>Complete 7 days to earn your first badge</div>
            </CupertinoCard>
          )}

          <CupertinoCard>
            <button onClick={async () => {
              if (window.confirm('Are you sure you want to leave the group?')) {
                await FirebaseService.leaveGroup(user.uid, userData?.groupCode);
                await refreshData();
              }
            }} style={{ width: '100%', padding: '14px', backgroundColor: 'transparent', color: '#FF3B30', border: 'none', fontSize: '16px', fontWeight: '500', cursor: 'pointer', borderRadius: '8px' }}>
              Leave Group
            </button>
            <div style={{ height: '1px', backgroundColor: '#E5E5EA', margin: '8px 0' }} />
            <button onClick={() => {
              if (window.confirm('This will reset your progress. Are you sure?')) {
                alert('Restart feature coming soon!');
              }
            }} style={{ width: '100%', padding: '14px', backgroundColor: 'transparent', color: '#FF9500', border: 'none', fontSize: '16px', fontWeight: '500', cursor: 'pointer', borderRadius: '8px' }}>
              Restart Challenge
            </button>
          </CupertinoCard>

          <div style={{ marginTop: '20px' }}>
            <CupertinoButton fullWidth onClick={async () => {
              await FirebaseService.signOut();
            }}>
              Sign Out
            </CupertinoButton>
          </div>
        </div>
      </div>
    );
  }

  return <LoadingScreen />;
}