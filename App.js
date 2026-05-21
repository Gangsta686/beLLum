import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  StatusBar,
  ScrollView,
  Image,
  Animated,
  Share,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import {
  isSupabaseConfigured,
  supabase,
  supabaseKey,
  supabaseUrl,
} from './lib/supabase';
import styles from './styles';
import { getPalette, HABIT_CATEGORY_COLORS } from './lib/theme';
import {
  createTranslator,
  EXERCISE_KEYS,
  normalizeCategoryKey,
  normalizeFrequencyKey,
  normalizePriorityKey,
} from './lib/i18n';
import {
  xpForCompletion,
  xpForChallengeOutcome,
  levelFromXP,
  prizeMultiplier,
} from './lib/xp';
import { diffNewAchievements, ACHIEVEMENT_BY_CODE } from './lib/achievements';
import { buildHabitsCsv, buildCompletionsCsv } from './lib/csv';
import { shareCsv } from './lib/export';
import { haptic } from './lib/haptics';
import {
  requestPushPermissions,
  scheduleHabitReminder,
  cancelHabitReminder,
  cancelAllReminders,
  scheduleChallengeWeekReminders,
  cancelChallengeWeekReminders,
} from './lib/notifications';
import HeatmapCalendar from './components/HeatmapCalendar';
import WeeklyBarChart from './components/WeeklyBarChart';
import ChallengeWeekHistory from './components/ChallengeWeekHistory';
import BadgeGrid from './components/BadgeGrid';
import LeaderboardList from './components/LeaderboardList';
import FriendsList from './components/FriendsList';
import ActivityFeed from './components/ActivityFeed';
import HabitForgeWebScreen from './components/HabitForgeWebScreen';
const {
  detectDeviceRegion,
  defaultsForRegion,
  sanitizeAmount: sanitizeTopUpAmount,
  formatAmount: formatTopUpAmount,
  createInvoice: createTopUpInvoice,
  fetchInvoiceStatus,
  pollInvoice,
} = require('./lib/payments');
const {
  formatDateKey,
  getJoinChallengeErrorMessage,
  getNextBetStats,
  mapParticipantRow,
  normalizeJoinChallengeResponse,
} = require('./lib/challengeUtils');
const {
  calculateStreak,
  longestStreak,
  toDateKey: streakDateKey,
} = require('./lib/streak');

const PURPLE = '#7C3AED';

const ADMIN_EMAIL = 'dav04010@gmail.com';

/** Default display name for offline guest; fixed literal, never switched with UI language. */
const GUEST_DEFAULT_DISPLAY_NAME = 'Гость';

const AnimatedCard = ({ children, style }) => {
  const scale = useRef(new Animated.Value(0.98)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  return (
    <Animated.View style={[{ transform: [{ scale }], opacity }, style]}>
      {children}
    </Animated.View>
  );
};

const ParticleBackground = ({ isDark }) => {
  const particles = useMemo(
    () =>
      Array.from({ length: 60 }, (_, index) => ({
        id: `p-${index}`,
        size: 1 + (index % 3),
        left: `${(index * 11) % 98}%`,
        top: `${(index * 19) % 98}%`,
        opacity: 0.25 + (index % 5) * 0.12,
      })),
    []
  );

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: 'transparent' },
      ]}
    >
      {particles.map((particle) => (
        <View
          key={particle.id}
          style={{
            position: 'absolute',
            width: particle.size,
            height: particle.size,
            borderRadius: particle.size / 2,
            backgroundColor: isDark ? '#FFFFFF' : '#FFFFFF',
            left: particle.left,
            top: particle.top,
            opacity: particle.opacity,
          }}
        />
      ))}
    </View>
  );
};

const GradientButton = ({
  label,
  onPress,
  style,
  buttonStyle,
  textStyle,
  iconName,
  accent = false,
}) => (
  <TouchableOpacity onPress={onPress} style={style} activeOpacity={0.85}>
    <View style={[styles.gradientButton, accent && styles.gradientButtonAccent, buttonStyle]}>
      {iconName ? (
        <Ionicons
          name={iconName}
          size={16}
          color={accent ? '#FFFFFF' : '#E2E8F0'}
          style={styles.gradientButtonIcon}
        />
      ) : null}
      <Text
        style={[
          styles.gradientButtonText,
          accent && styles.gradientButtonTextAccent,
          textStyle,
        ]}
      >
        {label}
      </Text>
    </View>
  </TouchableOpacity>
);

export default function App() {
  const APP_STATE_STORAGE_KEY = 'habitforge_app_state_v2';
  const AUTH_REQUEST_TIMEOUT_MS = 60000;
  const [isDark, setIsDark] = useState(true);
  const LOGIN_CHANGE_COOLDOWN_DAYS = 14;

  // Simple navigation between screens
  const [screen, setScreen] = useState('home'); // 'home' | 'habits' | 'challenge' | 'profile' | 'help' | 'topup' | 'weblanding'

  // Top-up state
  const [topUpRegion, setTopUpRegion] = useState(detectDeviceRegion());
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpInvoice, setTopUpInvoice] = useState(null);
  const [topUpStatus, setTopUpStatus] = useState('idle');
  const topUpPollAbortRef = useRef(false);

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState('register'); // 'register' | 'login'
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [loginInput, setLoginInput] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [registeredAt, setRegisteredAt] = useState('');
  const [isProfileReady, setIsProfileReady] = useState(false);
  const [loginDraft, setLoginDraft] = useState('');
  const [lastLoginChange, setLastLoginChange] = useState(null);
  const [loginError, setLoginError] = useState('');
  const [adminTopUpTarget, setAdminTopUpTarget] = useState('');
  const [adminTopUpAmount, setAdminTopUpAmount] = useState('500');
  const [adminTopUpBusy, setAdminTopUpBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef(null);

  // Habit state
  const [habitTitle, setHabitTitle] = useState('');
  const [habitDescription, setHabitDescription] = useState('');
  const HABIT_CATEGORY_IDS = ['health', 'sport', 'focus', 'sleep'];
  const HABIT_FREQUENCY_IDS = ['daily', 'threePerWeek', 'weekdays'];
  const HABIT_PRIORITY_IDS = ['low', 'medium', 'high'];
  const [habitCategory, setHabitCategory] = useState('health');
  const [habitFrequency, setHabitFrequency] = useState('daily');
  const [habitPriority, setHabitPriority] = useState('medium');
  const [habits, setHabits] = useState([]);

  // Challenge state
  const ENTRY_FEE = 500;
  const BASE_PRIZE = 1500;
  const MAX_PARTICIPANTS = 10;
  const WEEK_LENGTH_DAYS = 7;
  const DELETE_WINDOW_HOURS = 12;
  const [participants, setParticipants] = useState([]);
  const [nickname, setNickname] = useState('');
  const [myParticipantId, setMyParticipantId] = useState(null);
  const [groupError, setGroupError] = useState('');
  const [isJoiningChallenge, setIsJoiningChallenge] = useState(false);

  // Profile / stats state
  const avatarOptions = ['🔥', '🚀', '🏆', '🧠', '🦾', '🐉'];
  const [avatarIndex, setAvatarIndex] = useState(0);
  const [avatarUri, setAvatarUri] = useState('');
  const [avatarError, setAvatarError] = useState('');
  const [doneDays, setDoneDays] = useState(0);
  const [failedDays, setFailedDays] = useState(0);
  const [inProgressDays, setInProgressDays] = useState(0);
  const [totalBets, setTotalBets] = useState(0);
  const [averageBet, setAverageBet] = useState(0);
  const [balance, setBalance] = useState(0);

  // Gamification & social state
  const [language, setLanguage] = useState('ru');
  const t = useMemo(() => createTranslator(language), [language]);
  const localeTag = language === 'en' ? 'en-US' : 'ru-RU';
  const [xp, setXp] = useState(0);
  const levelInfo = useMemo(() => levelFromXP(xp), [xp]);
  const [achievements, setAchievements] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [pushToken, setPushToken] = useState(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [reminderHour, setReminderHour] = useState(9);
  const [reminderMinute, setReminderMinute] = useState(0);
  const [friendInput, setFriendInput] = useState('');
  const [friendships, setFriendships] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [feedEvents, setFeedEvents] = useState([]);
  const [feedReactions, setFeedReactions] = useState({});
  const [privateRooms, setPrivateRooms] = useState([]);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomTitleInput, setRoomTitleInput] = useState('');
  const [socialTab, setSocialTab] = useState('leaderboard');
  const [habitNoteDraft, setHabitNoteDraft] = useState({});
  const [habitPhotoDraft, setHabitPhotoDraft] = useState({});
  const [peerReviews, setPeerReviews] = useState([]);
  const [weeklyChallengeHistory, setWeeklyChallengeHistory] = useState([]);

  const persistAuthState = async (nextState) => {
    try {
      await AsyncStorage.setItem(
        APP_STATE_STORAGE_KEY,
        JSON.stringify(nextState)
      );
    } catch (error) {
      console.error('Failed to persist auth state:', error);
    }
  };

  const buildAuthSnapshot = () => ({
    loginName,
    userEmail,
    balance,
    avatarUri,
    language,
    isDark,
    notificationsEnabled,
    reminderHour,
    reminderMinute,
  });

  const clearAuthState = async () => {
    try {
      await AsyncStorage.removeItem(APP_STATE_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear auth state:', error);
    }
  };

  useEffect(() => {
    const restoreAuth = async () => {
      try {
        const stored = await AsyncStorage.getItem(APP_STATE_STORAGE_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (!parsed) return;
        if (parsed.loginName) {
          setLoginName(parsed.loginName);
          setLoginDraft(parsed.loginName);
        }
        if (parsed.userEmail) {
          setUserEmail(parsed.userEmail);
        }
        if (parsed.avatarUri) {
          setAvatarUri(parsed.avatarUri);
        }
        if (typeof parsed.balance === 'number') {
          setBalance(parsed.balance);
        }
        if (parsed.language === 'ru' || parsed.language === 'en') {
          setLanguage(parsed.language);
        }
        if (typeof parsed.isDark === 'boolean') {
          setIsDark(parsed.isDark);
        }
        if (typeof parsed.notificationsEnabled === 'boolean') {
          setNotificationsEnabled(parsed.notificationsEnabled);
        }
        if (Number.isFinite(parsed.reminderHour)) {
          setReminderHour(parsed.reminderHour);
        }
        if (Number.isFinite(parsed.reminderMinute)) {
          setReminderMinute(parsed.reminderMinute);
        }
      } catch (error) {
        console.error('Failed to restore auth state:', error);
      }
    };

    const applySessionState = (session) => {
      const user = session?.user;
      if (!user) {
        setIsAuthenticated(false);
        setCurrentUserId(null);
        setUserEmail('');
        setRegisteredAt('');
        setIsProfileReady(false);
        return;
      }
      const displayName =
        user.user_metadata?.display_name ||
        user.email?.split('@')[0] ||
        loginName;
      if (displayName) {
        setLoginName(displayName);
        setLoginDraft(displayName);
      }
      setUserEmail(user.email || '');
      setCurrentUserId(user.id);
      setRegisteredAt(user.created_at || '');
      setIsProfileReady(false);
      setIsAuthenticated(true);
      setScreen('home');
    };

    restoreAuth();
    if (!isSupabaseConfigured || !supabase) {
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to restore Supabase session:', error);
          return;
        }
        applySessionState(data.session);
      })
      .catch((error) => {
        console.error('Unexpected Supabase session restore error:', error);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        applySessionState(session);
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    Animated.timing(toastAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();

    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => setToast(null));
    }, 2800);
  }, [toast, toastAnim]);

  useEffect(() => {
    if (!isAuthenticated) return;
    persistAuthState(buildAuthSnapshot());
  }, [
    isAuthenticated,
    loginName,
    userEmail,
    balance,
    avatarUri,
    language,
    isDark,
    notificationsEnabled,
    reminderHour,
    reminderMinute,
  ]);

  const showToast = (type, message) => {
    setToast({ type, message });
  };

  const formatRegisteredAt = (value) => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleDateString(localeTag, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const withTimeout = async (promise, timeoutMs = 15000) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(t('errors.timeout'))),
        timeoutMs
      );
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const wait = (delayMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });

  const isNetworkAuthError = (error) => {
    const message = (error?.message || '').toLowerCase();
    return (
      message.includes('network request failed') ||
      message.includes('fetch failed') ||
      message.includes('econnreset')
    );
  };

  const withAuthRetry = async (requestFactory, attempts = 3) => {
    let lastResult;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await requestFactory();
        if (!isNetworkAuthError(result?.error) || attempt === attempts) {
          return result;
        }
        lastResult = result;
      } catch (error) {
        if (!isNetworkAuthError(error) || attempt === attempts) {
          throw error;
        }
        lastResult = { error };
      }
      await wait(1200 * attempt);
    }
    return lastResult;
  };

  const normalizeDirectAuthResponse = (payload) => {
    const session =
      payload?.access_token && payload?.refresh_token
        ? {
            access_token: payload.access_token,
            refresh_token: payload.refresh_token,
            expires_in: payload.expires_in,
            expires_at: payload.expires_at,
            token_type: payload.token_type || 'bearer',
            user: payload.user,
          }
        : payload?.session || null;
    return {
      data: {
        user: payload?.user || session?.user || null,
        session,
      },
      error: null,
    };
  };

  const requestSupabaseAuth = async (path, body) => {
    const response = await fetch(`${supabaseUrl}${path}`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      return {
        data: null,
        error: new Error(
          payload?.msg ||
            payload?.message ||
            payload?.error_description ||
            payload?.error ||
            t('errors.supabaseAuthStatus', { status: response.status })
        ),
      };
    }
    return normalizeDirectAuthResponse(payload);
  };

  const signUpWithFallback = async ({ email, password, displayName }) => {
    const result = await withAuthRetry(() =>
      withTimeout(
        supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName,
            },
          },
        }),
        AUTH_REQUEST_TIMEOUT_MS
      )
    );
    if (!isNetworkAuthError(result?.error)) {
      return result;
    }
    return withAuthRetry(() =>
      withTimeout(
        requestSupabaseAuth('/auth/v1/signup', {
          email,
          password,
          data: {
            display_name: displayName,
          },
        }),
        AUTH_REQUEST_TIMEOUT_MS
      )
    );
  };

  const signInWithFallback = async ({ email, password }) => {
    const result = await withAuthRetry(() =>
      withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
        AUTH_REQUEST_TIMEOUT_MS
      )
    );
    if (!isNetworkAuthError(result?.error)) {
      return result;
    }
    return withAuthRetry(() =>
      withTimeout(
        requestSupabaseAuth('/auth/v1/token?grant_type=password', {
          email,
          password,
        }),
        AUTH_REQUEST_TIMEOUT_MS
      )
    );
  };

  const persistFallbackSession = async (session) => {
    if (!session?.access_token || !session?.refresh_token) return;
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) {
      console.error('Failed to persist fallback auth session:', error);
    }
  };

  const getProfileSyncHint = (error) => {
    const message = (error?.message || '').toLowerCase();
    if (message.includes('relation') && message.includes('profiles')) {
      return t('errors.profileTableMissing');
    }
    if (
      message.includes('row-level security') ||
      message.includes('permission denied') ||
      error?.code === '42501'
    ) {
      return t('errors.profileNoPermission');
    }
    return t('errors.profileGeneric', {
      message: error?.message || t('errors.unknown'),
    });
  };

  const getAuthErrorMessage = (error, fallback) => {
    const message = error?.message || '';
    const normalized = message.toLowerCase();
    if (normalized.includes('already registered')) {
      return t('errors.authAlreadyRegistered');
    }
    if (normalized.includes('password')) {
      return t('errors.authPasswordShort');
    }
    if (normalized.includes('email not confirmed')) {
      return t('errors.authEmailNotConfirmed');
    }
    if (normalized.includes('email rate limit exceeded')) {
      return t('errors.authEmailRateLimit');
    }
    if (normalized.includes('invalid login credentials')) {
      return t('errors.authInvalidCredentials');
    }
    if (isNetworkAuthError(error)) {
      return t('errors.authNetwork');
    }
    if (message.includes('Превышено время ожидания') || message.includes('timed out')) {
      return t('errors.authTimeoutWait');
    }
    return message || fallback;
  };

  useEffect(() => {
    if (!isAuthenticated || !currentUserId || !isSupabaseConfigured || !supabase) {
      return;
    }

    let isCancelled = false;
    const hydrateProfile = async () => {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) {
        console.error('Failed to read Supabase session:', sessionError);
        if (!isCancelled) {
          showToast('warning', t('errors.sessionRead'));
          setIsProfileReady(true);
        }
        return;
      }
      if (!sessionData?.session?.user || sessionData.session.user.id !== currentUserId) {
        if (!isCancelled) setIsProfileReady(true);
        return;
      }

      const fallbackName = loginName || loginDraft || '';
      const upsertPayload = {
        id: currentUserId,
        display_name: fallbackName || null,
      };
      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert(upsertPayload, { onConflict: 'id' });
      if (upsertError) {
        console.error('Failed to upsert profile:', upsertError);
        if (!isCancelled) {
          showToast('warning', getProfileSyncHint(upsertError));
          setIsProfileReady(true);
        }
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select(
          'display_name, balance, created_at, xp, level, language, theme, current_streak, best_streak, notifications_enabled'
        )
        .eq('id', currentUserId)
        .single();
      if (error) {
        console.error('Failed to load profile:', error);
        if (!isCancelled) {
          showToast('warning', getProfileSyncHint(error));
          setIsProfileReady(true);
        }
        return;
      }
      if (isCancelled) return;

      if (typeof data?.balance === 'number') {
        setBalance(data.balance);
      }
      if (data?.display_name) {
        setLoginName(data.display_name);
        setLoginDraft(data.display_name);
      }
      if (!registeredAt && data?.created_at) {
        setRegisteredAt(data.created_at);
      }
      if (typeof data?.xp === 'number') {
        setXp(data.xp);
      }
      if (data?.language === 'ru' || data?.language === 'en') {
        setLanguage(data.language);
      }
      if (data?.theme === 'dark' || data?.theme === 'light') {
        setIsDark(data.theme === 'dark');
      }
      if (typeof data?.notifications_enabled === 'boolean') {
        setNotificationsEnabled(data.notifications_enabled);
      }
      setIsProfileReady(true);
    };

    hydrateProfile();
    return () => {
      isCancelled = true;
    };
  }, [isAuthenticated, currentUserId]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      !currentUserId ||
      !isProfileReady ||
      !isSupabaseConfigured ||
      !supabase
    ) {
      return;
    }

    const syncProfile = async () => {
      const { error } = await supabase.from('profiles').upsert(
        {
          id: currentUserId,
          display_name: loginName || null,
          balance,
          xp,
          level: levelInfo.level,
          language,
          theme: isDark ? 'dark' : 'light',
          notifications_enabled: notificationsEnabled,
          push_token: pushToken,
        },
        { onConflict: 'id' }
      );
      if (error) {
        console.error('Failed to sync profile:', error);
      }
    };

    syncProfile();
  }, [
    isAuthenticated,
    currentUserId,
    isProfileReady,
    loginName,
    balance,
    xp,
    levelInfo.level,
    language,
    isDark,
    notificationsEnabled,
    pushToken,
  ]);

  const getWeekStartDate = (date = new Date()) => {
    const current = new Date(date);
    const day = current.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    current.setHours(0, 0, 0, 0);
    current.setDate(current.getDate() + diff);
    return current;
  };
  const pickWeeklyExercises = (keys) => {
    const count = Math.floor(Math.random() * 3) + 1;
    const shuffled = [...keys].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  };
  const [challenges, setChallenges] = useState([]);
  const [challengeFilter, setChallengeFilter] = useState('all');
  const [challengePage, setChallengePage] = useState(1);
  const [weeklyStartAt, setWeeklyStartAt] = useState(() => getWeekStartDate());
  const [weeklyExercises, setWeeklyExercises] = useState(() =>
    pickWeeklyExercises(EXERCISE_KEYS)
  );
  const [weeklyOutcome, setWeeklyOutcome] = useState(null); // 'success' | 'fail'
  const [weeklyTask, setWeeklyTask] = useState(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const palette = useMemo(() => getPalette(isDark ? 'dark' : 'light'), [isDark]);
  const backgroundColor = palette.bg;
  const textColor = palette.text;
  const cardColor = 'transparent';
  const secondaryText = palette.textMuted;
  const borderColor = palette.border;

  const msInDay = 24 * 60 * 60 * 1000;
  const prizePool = BASE_PRIZE + participants.length * ENTRY_FEE;
  const weeklyEndAt = new Date(
    weeklyStartAt.getTime() + (WEEK_LENGTH_DAYS - 1) * msInDay
  );
  const weeklyStartKey = formatDateKey(weeklyStartAt);
  const weeklyDeadlineMs =
    weeklyStartAt.getTime() + WEEK_LENGTH_DAYS * msInDay;
  const weeklyRemainingMs = Math.max(0, weeklyDeadlineMs - nowTick);
  const syncChallengeWeekReminders = useCallback(async () => {
    if (!notificationsEnabled || !isAuthenticated || !currentUserId) {
      await cancelChallengeWeekReminders(weeklyStartKey);
      return;
    }
    await scheduleChallengeWeekReminders({
      weekStartKey: weeklyStartKey,
      weekStartAt: weeklyStartAt,
      reminderHour,
      reminderMinute,
      betContent: {
        title: t('notifications.challengeBetTitle'),
        body: t('notifications.challengeBetBody'),
      },
      midContent: {
        title: t('notifications.challengeMidTitle'),
        body: t('notifications.challengeMidBody'),
      },
      summaryContent: {
        title: t('notifications.challengeSummaryTitle'),
        body: t('notifications.challengeSummaryBody'),
      },
    });
  }, [
    notificationsEnabled,
    isAuthenticated,
    currentUserId,
    weeklyStartKey,
    weeklyStartAt,
    reminderHour,
    reminderMinute,
    t,
  ]);
  const weekElapsedDays = Math.floor(
    (Date.now() - weeklyStartAt.getTime()) / msInDay
  );
  const weekEnded = weekElapsedDays >= WEEK_LENGTH_DAYS;
  const canFinalizeWeek = weekEnded;
  const winnersCount = participants.filter((p) => p.status === 'success').length;
  const payoutPerWinner =
    winnersCount > 0 ? Math.floor(prizePool / winnersCount) : 0;
  const isJoined = Boolean(myParticipantId);
  const itemsPerPage = 5;
  const now = new Date();
  const isSameMonth = (date) =>
    date &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  const filteredChallenges = useMemo(() => {
    return challenges.filter((challenge) => {
      if (challengeFilter === 'all') return true;
      if (challengeFilter === 'active') return challenge.status === 'active';
      if (challengeFilter === 'success')
        return challenge.status === 'success' && isSameMonth(challenge.completedAt);
      if (challengeFilter === 'fail')
        return challenge.status === 'fail' && isSameMonth(challenge.completedAt);
      return true;
    });
  }, [challengeFilter, challenges]);
  const totalPages = Math.max(
    1,
    Math.ceil(filteredChallenges.length / itemsPerPage)
  );
  const safePage = Math.min(challengePage, totalPages);
  const paginatedChallenges = filteredChallenges.slice(
    (safePage - 1) * itemsPerPage,
    safePage * itemsPerPage
  );
  const personalTotal = challenges.length;
  const personalSuccess = challenges.filter((c) => c.status === 'success').length;
  const personalFail = challenges.filter((c) => c.status === 'fail').length;
  const personalActive = challenges.filter((c) => c.status === 'active').length;
  const personalSuccessPercent =
    personalTotal === 0 ? 0 : Math.round((personalSuccess / personalTotal) * 100);
  const averageChallengeBet =
    personalTotal === 0
      ? 0
      : Math.round(
          challenges.reduce((sum, challenge) => sum + challenge.bet, 0) /
            personalTotal
        );
  const daysSinceLoginChange = lastLoginChange
    ? Math.floor((Date.now() - lastLoginChange) / msInDay)
    : null;
  const loginDaysLeft =
    lastLoginChange === null
      ? 0
      : Math.max(0, LOGIN_CHANGE_COOLDOWN_DAYS - daysSinceLoginChange);
  const canChangeLogin =
    lastLoginChange === null || daysSinceLoginChange >= LOGIN_CHANGE_COOLDOWN_DAYS;

  const inputThemeStyle = {
    color: textColor,
    borderColor: '#334155',
    backgroundColor: isDark ? '#060B18' : '#060B18',
  };

  const totalDays = doneDays + failedDays + inProgressDays;
  const successPercent =
    totalDays === 0 ? 0 : Math.round((doneDays / totalDays) * 100);

  const mapWeeklyParticipantRow = useCallback(
    (row) => mapParticipantRow(row, currentUserId, ENTRY_FEE),
    [currentUserId, ENTRY_FEE]
  );

  const loadWeeklyParticipants = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) {
      setParticipants([]);
      setMyParticipantId(null);
      return [];
    }

    const { data, error } = await withTimeout(
      supabase
        .from('weekly_challenge_participants')
        .select('id, user_id, week_start, display_name, status, entry_fee, joined_at')
        .eq('week_start', weeklyStartKey)
        .order('joined_at', { ascending: true }),
      10000
    );

    if (error) {
      console.error('Failed to load weekly participants:', error);
      setGroupError(t('errors.loadParticipantsFailed'));
      return null;
    }

    const nextParticipants = (data || []).map(mapWeeklyParticipantRow);
    setParticipants(nextParticipants);
    const myParticipant = nextParticipants.find(
      (participant) => participant.userId === currentUserId
    );
    setMyParticipantId(myParticipant?.id || null);
    return nextParticipants;
  }, [currentUserId, mapWeeklyParticipantRow, weeklyStartKey, t]);

  const loadWeeklyTask = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setWeeklyTask(null);
      return;
    }
    const { data, error } = await withTimeout(
      supabase
        .from('weekly_challenge_tasks')
        .select('week_start, title, description, ai_criteria')
        .eq('week_start', weeklyStartKey)
        .maybeSingle(),
      10000
    );
    if (error) {
      console.error('Failed to load weekly task:', error);
      return;
    }
    setWeeklyTask(data || null);
  }, [weeklyStartKey]);

  const loadProfileBalance = async () => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) {
      return;
    }

    const { data, error } = await withTimeout(
      supabase
        .from('profiles')
        .select('balance')
        .eq('id', currentUserId)
        .single(),
      10000
    );

    if (error) {
      console.error('Failed to reload profile balance:', error);
      return;
    }

    if (typeof data?.balance === 'number') {
      setBalance(data.balance);
    }
  };

  const reloadChallengeState = async () => {
    try {
      await Promise.all([loadProfileBalance(), loadWeeklyChallengeHistory()]);
      return await loadWeeklyParticipants();
    } catch (error) {
      console.error('Failed to reload challenge state:', error);
      return null;
    }
  };

  const recoverJoinedParticipant = async () => {
    const retryDelays = [0, 1500, 3000, 5000];
    for (const delay of retryDelays) {
      if (delay > 0) {
        await wait(delay);
      }

      const nextParticipants = await reloadChallengeState();
      const myParticipant = nextParticipants?.find(
        (participant) => participant.userId === currentUserId
      );
      if (myParticipant) {
        setMyParticipantId(myParticipant.id);
        setGroupError('');
        showToast('success', t('errors.participationRestored'));
        return myParticipant;
      }
    }

    return null;
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setParticipants([]);
      setMyParticipantId(null);
      return;
    }

    loadWeeklyParticipants();
  }, [isAuthenticated, loadWeeklyParticipants]);

  useEffect(() => {
    loadWeeklyTask();
  }, [loadWeeklyTask]);

  // Per-second tick for the countdown + automatic weekly rollover: when the
  // wall clock crosses into a new ISO week, recompute weeklyStartAt, which
  // re-keys the task/participant loaders so the new week's task loads itself.
  useEffect(() => {
    const id = setInterval(() => {
      setNowTick(Date.now());
      const fresh = getWeekStartDate();
      if (formatDateKey(fresh) !== weeklyStartKey) {
        setWeeklyStartAt(fresh);
        setWeeklyExercises(pickWeeklyExercises(EXERCISE_KEYS));
        setWeeklyOutcome(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [weeklyStartKey]);

  useEffect(() => {
    if (!isAuthenticated || !isSupabaseConfigured || !supabase || !currentUserId) {
      return;
    }

    const channel = supabase
      .channel(`weekly-challenge-${weeklyStartKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'weekly_challenge_participants',
          filter: `week_start=eq.${weeklyStartKey}`,
        },
        () => {
          loadWeeklyParticipants();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, isAuthenticated, loadWeeklyParticipants, weeklyStartKey]);

  useEffect(() => {
    syncChallengeWeekReminders();
  }, [syncChallengeWeekReminders]);

  // ========================================================================
  //  Habit completions (cloud-synced)
  // ========================================================================

  const loadHabitCompletions = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) return;
    const { data, error } = await supabase
      .from('habit_completions')
      .select('*')
      .eq('user_id', currentUserId)
      .order('done_date', { ascending: false })
      .limit(500);
    if (error) {
      console.error('Failed to load completions:', error);
      return;
    }
    setCompletions(data || []);
  }, [currentUserId]);

  const loadAchievements = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) return;
    const { data, error } = await supabase
      .from('user_achievements')
      .select('code, unlocked_at')
      .eq('user_id', currentUserId);
    if (error) {
      console.error('Failed to load achievements:', error);
      return;
    }
    setAchievements((data || []).map((row) => row.code));
  }, [currentUserId]);

  const loadLeaderboard = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data, error } = await supabase
      .from('all_time_leaderboard')
      .select('*')
      .limit(50);
    if (error) {
      console.error('Failed to load leaderboard:', error);
      return;
    }
    setLeaderboard(data || []);
  }, []);

  const loadFeed = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data, error } = await supabase
      .from('activity_feed')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      console.error('Failed to load feed:', error);
      return;
    }
    const events = data || [];
    setFeedEvents(events);
    if (events.length > 0) {
      const ids = events.map((e) => e.id);
      const { data: rxData, error: rxError } = await supabase
        .from('activity_reactions')
        .select('*')
        .in('activity_id', ids);
      if (!rxError) {
        const map = {};
        for (const reaction of rxData || []) {
          if (!map[reaction.activity_id]) map[reaction.activity_id] = [];
          map[reaction.activity_id].push(reaction);
        }
        setFeedReactions(map);
      }
    } else {
      setFeedReactions({});
    }
  }, []);

  const loadFriendships = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) return;
    const { data, error } = await supabase
      .from('friendships')
      .select('*')
      .or(`requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`);
    if (error) {
      console.error('Failed to load friendships:', error);
      return;
    }
    const partners = Array.from(new Set(
      (data || []).map((row) =>
        row.requester_id === currentUserId ? row.addressee_id : row.requester_id
      )
    ));
    let nameMap = {};
    if (partners.length > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', partners);
      nameMap = (profileRows || []).reduce((acc, row) => {
        acc[row.id] = row.display_name;
        return acc;
      }, {});
    }
    setFriendships(
      (data || []).map((row) => ({
        ...row,
        requester_name: nameMap[row.requester_id],
        addressee_name: nameMap[row.addressee_id],
      }))
    );
  }, [currentUserId]);

  const loadPrivateRooms = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) return;
    const { data, error } = await supabase
      .from('private_challenges')
      .select(
        'id, title, description, invite_code, entry_fee, max_participants, starts_at, ends_at, status, owner_id, created_at'
      )
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Failed to load private rooms:', error);
      return;
    }
    setPrivateRooms(data || []);
  }, [currentUserId]);

  const loadWeeklyChallengeHistory = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) {
      setWeeklyChallengeHistory([]);
      return;
    }
    const { data, error } = await withTimeout(
      supabase
        .from('weekly_challenge_participants')
        .select('week_start, status')
        .eq('user_id', currentUserId)
        .order('week_start', { ascending: false })
        .limit(52),
      10000
    );
    if (error) {
      console.error('Failed to load weekly challenge history:', error);
      return;
    }
    setWeeklyChallengeHistory(data || []);
  }, [currentUserId]);

  const weeklyHistoryStats = useMemo(() => {
    const rows = weeklyChallengeHistory;
    const total = rows.length;
    const wins = rows.filter((r) => r.status === 'success').length;
    const fails = rows.filter((r) => r.status === 'fail').length;
    const decided = wins + fails;
    const winRate = decided === 0 ? null : Math.round((wins / decided) * 100);
    const chartWeeks = [...rows].slice(0, 16).reverse();
    return { total, wins, fails, winRate, chartWeeks };
  }, [weeklyChallengeHistory]);

  useEffect(() => {
    if (!isAuthenticated) {
      setCompletions([]);
      setAchievements([]);
      setFriendships([]);
      setLeaderboard([]);
      setFeedEvents([]);
      setFeedReactions({});
      setPrivateRooms([]);
      setWeeklyChallengeHistory([]);
      return;
    }
    loadHabitCompletions();
    loadAchievements();
    loadLeaderboard();
    loadFeed();
    loadFriendships();
    loadPrivateRooms();
    loadWeeklyChallengeHistory();
  }, [
    isAuthenticated,
    loadHabitCompletions,
    loadAchievements,
    loadLeaderboard,
    loadFeed,
    loadFriendships,
    loadPrivateRooms,
    loadWeeklyChallengeHistory,
  ]);

  // Realtime feed
  useEffect(() => {
    if (!isAuthenticated || !isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel('activity-feed-global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_feed' }, () => {
        loadFeed();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_reactions' }, () => {
        loadFeed();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, loadFeed]);

  // Aggregations derived from completions
  const doneByDate = useMemo(() => {
    const map = {};
    for (const completion of completions) {
      if (completion.status !== 'done') continue;
      const key = completion.done_date;
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [completions]);

  const doneDateKeys = useMemo(
    () => Object.keys(doneByDate).filter((key) => doneByDate[key] > 0).sort(),
    [doneByDate]
  );

  const todayKey = streakDateKey(new Date());

  const overallStreak = useMemo(
    () => calculateStreak(doneDateKeys, todayKey, 1),
    [doneDateKeys, todayKey]
  );
  const overallBestStreak = useMemo(
    () => longestStreak(doneDateKeys, 1),
    [doneDateKeys]
  );

  const weekdayCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const key of doneDateKeys) {
      const date = new Date(`${key}T00:00:00`);
      const idx = (date.getDay() + 6) % 7;
      counts[idx] += 1;
    }
    return counts;
  }, [doneDateKeys]);

  // Achievements snapshot evaluation
  useEffect(() => {
    if (!isAuthenticated || !currentUserId || !isSupabaseConfigured || !supabase) {
      return;
    }
    const completionsCount = completions.filter((c) => c.status === 'done').length;
    const challengeWins = completions.filter((c) => c.status === 'done').length > 0
      ? leaderboard.find((row) => row.user_id === currentUserId)?.wins || 0
      : 0;
    const friendsCount = friendships.filter((row) => row.status === 'accepted').length;
    const hasPhoto = completions.some((c) => Boolean(c.photo_url));
    const hasPrivate = privateRooms.some((room) => room.owner_id === currentUserId);
    const categoriesUsed = new Set(
      habits
        .map((h) => normalizeCategoryKey(h.category))
        .concat(completions.map((c) => normalizeCategoryKey(c.habit_category)))
        .filter(Boolean)
    );
    const doneAtHours = completions
      .map((c) => (c.created_at ? new Date(c.created_at).getHours() : null))
      .filter((h) => h !== null);

    const newOnes = diffNewAchievements(achievements, {
      habitsCount: habits.length,
      totalDone: completionsCount,
      streak: overallStreak.current,
      level: levelInfo.level,
      challengeWins,
      friendsCount,
      hasPhoto,
      hasPrivate,
      categoriesUsed,
      doneAtHours,
    });
    if (newOnes.length === 0) return;

    (async () => {
      try {
        const rows = newOnes.map((code) => ({ user_id: currentUserId, code }));
        const { error } = await supabase
          .from('user_achievements')
          .upsert(rows, { onConflict: 'user_id,code', ignoreDuplicates: true });
        if (error) {
          console.error('Failed to persist achievements:', error);
          return;
        }
        setAchievements((prev) => Array.from(new Set([...prev, ...newOnes])));
        const titles = newOnes.map(
          (code) => t(`achievements.${code}.title`) || ACHIEVEMENT_BY_CODE[code]?.title || code
        );
        showToast('success', t('errors.badgeNew', { titles: titles.join(', ') }));
        haptic.success();
        for (const code of newOnes) {
          await supabase.from('activity_feed').insert({
            user_id: currentUserId,
            display_name: loginName || null,
            kind: 'achievement',
            payload: {
              code,
              title: t(`achievements.${code}.title`) || ACHIEVEMENT_BY_CODE[code]?.title,
            },
          });
        }
      } catch (error) {
        console.error('Achievements unlock error:', error);
      }
    })();
  }, [
    achievements,
    completions,
    habits,
    overallStreak.current,
    levelInfo.level,
    friendships,
    privateRooms,
    leaderboard,
    isAuthenticated,
    currentUserId,
    loginName,
    t,
  ]);

  // ========================================================================
  //  Push notifications
  // ========================================================================

  const ensurePushPermission = useCallback(async () => {
    if (!notificationsEnabled) return null;
    const result = await requestPushPermissions();
    if (!result.granted) {
      setNotificationsEnabled(false);
      showToast('warning', t('notifications.permissionDenied'));
      return null;
    }
    if (result.token) {
      setPushToken(result.token);
    }
    return result;
  }, [notificationsEnabled, t]);

  useEffect(() => {
    if (!isAuthenticated) return;
    ensurePushPermission();
  }, [isAuthenticated, ensurePushPermission]);

  const toggleNotifications = useCallback(async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      await cancelAllReminders();
      showToast('warning', t('notifications.disabled'));
      return;
    }
    setNotificationsEnabled(true);
    const result = await requestPushPermissions();
    if (!result.granted) {
      setNotificationsEnabled(false);
      showToast('warning', t('notifications.permissionDenied'));
      return;
    }
    if (result.token) setPushToken(result.token);
    for (const habit of habits) {
      if (habit.reminderEnabled !== false) {
        await scheduleHabitReminder({
          habitId: habit.id,
          title: habit.title,
          body: habit.description || t('habits.remind'),
          hours: habit.reminderHour ?? reminderHour,
          minutes: habit.reminderMinute ?? reminderMinute,
        });
      }
    }
    await syncChallengeWeekReminders();
    showToast('success', t('notifications.enabled'));
  }, [
    notificationsEnabled,
    habits,
    reminderHour,
    reminderMinute,
    t,
    syncChallengeWeekReminders,
  ]);

  // ========================================================================
  //  Habit completions: write side
  // ========================================================================

  const writeFeedEvent = async (kind, payload) => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) return;
    try {
      await supabase.from('activity_feed').insert({
        user_id: currentUserId,
        display_name: loginName || null,
        kind,
        payload: payload || {},
      });
    } catch (error) {
      console.error('Failed to write feed event:', error);
    }
  };

  const markHabitDone = async (habit) => {
    if (!habit) return;
    const date = streakDateKey(new Date());
    const note = (habitNoteDraft[habit.id] || '').trim() || null;
    const photoUrl = habitPhotoDraft[habit.id] || null;
    const priorHabitDates = doneDateKeys.filter((key) => key <= date);
    const streakResult = calculateStreak(priorHabitDates, date, 1);
    const xpEarned = xpForCompletion({
      priority: normalizePriorityKey(habit.priority),
      streak: streakResult.current,
      perfectDay: habits.length > 0 && habits.every((h) => {
        if (h.id === habit.id) return true;
        return completions.some((c) => c.habit_id === h.id && c.done_date === date && c.status === 'done');
      }),
    });

    if (isSupabaseConfigured && supabase && currentUserId) {
      const { error } = await supabase.from('habit_completions').upsert(
        {
          user_id: currentUserId,
          habit_id: habit.id,
          habit_title: habit.title,
          habit_category: normalizeCategoryKey(habit.category),
          done_date: date,
          status: 'done',
          note,
          photo_url: photoUrl,
          xp_awarded: xpEarned,
        },
        { onConflict: 'user_id,habit_id,done_date' }
      );
      if (error) {
        console.error('Failed to mark habit done:', error);
        showToast('error', t('errors.habitCloudSave'));
      } else {
        await writeFeedEvent('habit_done', {
          habit_id: habit.id,
          title: habit.title,
          text: `✅ ${habit.title}${note ? ` — ${note}` : ''}`,
          xp: xpEarned,
        });
      }
    }
    setXp((prev) => prev + xpEarned);
    setDoneDays((prev) => prev + 1);
    setHabits((prev) =>
      prev.map((h) =>
        h.id === habit.id ? { ...h, progress: (h.progress || 0) + 1 } : h
      )
    );
    setHabitNoteDraft((prev) => ({ ...prev, [habit.id]: '' }));
    setHabitPhotoDraft((prev) => ({ ...prev, [habit.id]: '' }));
    haptic.success();
    showToast('success', `+${xpEarned} XP`);
    loadHabitCompletions();
  };

  const pickHabitPhoto = async (habit) => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast('warning', t('errors.photosDenied'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
      });
      if (result.canceled) return;
      const selected = result.assets && result.assets[0];
      if (!selected?.uri) return;
      setHabitPhotoDraft((prev) => ({ ...prev, [habit.id]: selected.uri }));
      showToast('success', t('errors.photoNextMark'));
    } catch (error) {
      console.error('Habit photo pick failed:', error);
      showToast('error', t('errors.pickPhotoFailed'));
    }
  };

  const setHabitReminderTime = async (habit, hours, minutes) => {
    if (!notificationsEnabled) {
      showToast('warning', t('notifications.disabled'));
      return;
    }
    await scheduleHabitReminder({
      habitId: habit.id,
      title: habit.title,
      body: habit.description || t('habits.remind'),
      hours,
      minutes,
    });
    setHabits((prev) =>
      prev.map((h) =>
        h.id === habit.id
          ? { ...h, reminderHour: hours, reminderMinute: minutes, reminderEnabled: true }
          : h
      )
    );
    showToast('success', t('errors.reminderSet', {
      time: `${`${hours}`.padStart(2, '0')}:${`${minutes}`.padStart(2, '0')}`,
    }));
  };

  // ========================================================================
  //  Friends / private rooms / activity reactions
  // ========================================================================

  const addFriendByName = async () => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) return;
    const name = friendInput.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name')
      .ilike('display_name', name)
      .limit(1);
    if (error) {
      console.error('Friend lookup failed:', error);
      showToast('error', t('errors.userLookupError'));
      return;
    }
    const target = (data || [])[0];
    if (!target) {
      showToast('warning', t('errors.userNotFound'));
      return;
    }
    if (target.id === currentUserId) {
      showToast('warning', t('errors.friendSelf'));
      return;
    }
    const { error: insertError } = await supabase.from('friendships').insert({
      requester_id: currentUserId,
      addressee_id: target.id,
      status: 'pending',
    });
    if (insertError) {
      console.error('Friend request failed:', insertError);
      showToast('error', t('errors.friendRequestFailed'));
      return;
    }
    showToast('success', t('errors.friendRequestSent'));
    haptic.success();
    setFriendInput('');
    loadFriendships();
  };

  const respondFriend = async (row, status) => {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase
      .from('friendships')
      .update({ status })
      .eq('id', row.id);
    if (error) {
      console.error('Friend response failed:', error);
      showToast('error', t('errors.friendshipUpdateFailed'));
      return;
    }
    showToast(
      'success',
      status === 'accepted' ? t('errors.friendAdded') : t('errors.friendDeclined')
    );
    haptic.selection();
    loadFriendships();
  };

  const removeFriend = async (row) => {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase.from('friendships').delete().eq('id', row.id);
    if (error) {
      console.error('Friend remove failed:', error);
      return;
    }
    showToast('warning', t('errors.friendRemoved'));
    loadFriendships();
  };

  const reactToActivity = async (event) => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) return;
    const list = feedReactions[event.id] || [];
    const mine = list.find((r) => r.user_id === currentUserId);
    if (mine) {
      await supabase.from('activity_reactions').delete().eq('id', mine.id);
    } else {
      await supabase.from('activity_reactions').insert({
        activity_id: event.id,
        user_id: currentUserId,
        emoji: '🔥',
      });
      haptic.light();
    }
    loadFeed();
  };

  const createPrivateRoom = async () => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) return;
    const title = roomTitleInput.trim();
    if (!title) {
      showToast('warning', t('errors.roomNameRequired'));
      return;
    }
    const today = new Date();
    const ends = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { data, error } = await supabase.rpc('create_private_challenge', {
      challenge_title: title,
      challenge_description: null,
      challenge_entry_fee: 500,
      challenge_max_participants: 10,
      challenge_starts_at: streakDateKey(today),
      challenge_ends_at: streakDateKey(ends),
    });
    if (error) {
      console.error('Failed to create private room:', error);
      showToast('error', t('errors.roomCreateFailed'));
      return;
    }
    showToast('success', t('social.roomCreated', { code: data?.invite_code || '' }));
    haptic.success();
    setRoomTitleInput('');
    loadPrivateRooms();
  };

  const joinPrivateRoom = async () => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) return;
    const code = roomCodeInput.trim().toUpperCase();
    if (!code) {
      showToast('warning', t('errors.roomCodeRequired'));
      return;
    }
    const { error } = await supabase.rpc('join_private_challenge_by_code', {
      code,
      participant_name: loginName || 'Player',
    });
    if (error) {
      const msg = (error.message || '').includes('insufficient_balance')
        ? t('errors.roomJoinBalance')
        : (error.message || '').includes('challenge_full')
        ? t('errors.roomJoinFull')
        : (error.message || '').includes('already_joined')
        ? t('errors.roomJoinDuplicate')
        : (error.message || '').includes('challenge_not_found')
        ? t('errors.roomJoinMissing')
        : t('errors.roomJoinFailed');
      showToast('error', msg);
      return;
    }
    showToast('success', t('errors.roomJoined'));
    haptic.success();
    setRoomCodeInput('');
    loadPrivateRooms();
    loadProfileBalance();
  };

  const sharePrivateRoom = async (room) => {
    try {
      await Share.share({
        message: t('social.shareRoomMessage', {
          title: room.title,
          code: room.invite_code,
        }),
      });
    } catch (error) {
      console.error('Share private room failed:', error);
    }
  };

  // ========================================================================
  //  CSV export
  // ========================================================================

  const exportData = async () => {
    const csv = [
      `# beLLum export ${new Date().toISOString()}`,
      buildHabitsCsv(habits),
      '',
      buildCompletionsCsv(completions),
    ].join('\n');
    const result = await shareCsv({
      filename: `bellum_${streakDateKey(new Date())}.csv`,
      content: csv,
    });
    if (!result.ok) {
      showToast('error', t('errors.exportUnavailable'));
      return;
    }
    showToast(
      'success',
      result.shared ? t('errors.csvShared') : t('errors.csvSaved')
    );
    haptic.success();
  };

  const handleAdminTopUp = async () => {
    const target = adminTopUpTarget.trim();
    const amount = parseInt(adminTopUpAmount, 10);
    console.log('[admin_top_up] click', { target, amount });
    if (!target) {
      Alert.alert('Заполни поле', 'Укажи email или имя пользователя');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Сумма', 'Сумма должна быть > 0');
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      Alert.alert('Конфиг', 'Supabase не сконфигурирован');
      return;
    }
    setAdminTopUpBusy(true);
    const startedAt = Date.now();
    try {
      const probe = async (label, url) => {
        const t = Date.now();
        const c = new AbortController();
        const id = setTimeout(() => c.abort(), 8000);
        try {
          const r = await fetch(url, { signal: c.signal });
          clearTimeout(id);
          console.log(`[probe] ${label}`, { status: r.status, ms: Date.now() - t });
          return { ok: true, status: r.status, ms: Date.now() - t };
        } catch (e) {
          clearTimeout(id);
          console.log(`[probe] ${label} FAIL`, e?.message, Date.now() - t);
          return { ok: false, err: e?.message, ms: Date.now() - t };
        }
      };
      const p1 = await probe('google204', 'https://www.google.com/generate_204');
      const p2 = await probe('supabase-root', `${supabaseUrl}/rest/v1/`);
      Alert.alert(
        'Сетевой тест',
        `Google: ${p1.ok ? 'OK ' + p1.status + ' (' + p1.ms + 'ms)' : 'FAIL ' + p1.err}\n` +
        `Supabase: ${p2.ok ? 'OK ' + p2.status + ' (' + p2.ms + 'ms)' : 'FAIL ' + p2.err}`
      );
      if (!p2.ok) return;
      console.log('[admin_top_up] fetching session…');
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      console.log('[admin_top_up] session', {
        hasToken: !!accessToken,
        ms: Date.now() - startedAt,
      });
      if (!accessToken) {
        Alert.alert('Сессия', 'Нет access_token — переавторизуйся');
        return;
      }

      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 12000);
      console.log('[admin_top_up] raw POST to PostgREST…');
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/rpc/admin_top_up_safe`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ target, amount }),
        }
      );
      clearTimeout(tid);
      const text = await resp.text();
      const ms = Date.now() - startedAt;
      console.log('[admin_top_up] response', { status: resp.status, ms, text });

      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (_e) {
        // not JSON
      }

      if (!resp.ok) {
        const msg = parsed?.message || text || `HTTP ${resp.status}`;
        const friendly = /forbidden/i.test(msg)
          ? 'Нет прав (вашего user_id нет в admin_users)'
          : /invalid_amount/i.test(msg)
          ? 'Сумма вне допустимого диапазона (1–100 000)'
          : /user not found/i.test(msg)
          ? 'Пользователь не найден'
          : `Ошибка: ${msg}`;
        Alert.alert('Ошибка', `${friendly}\n(${ms} мс)`);
        return;
      }

      const row = Array.isArray(parsed) ? parsed[0] : parsed;
      const name = row?.user_display_name || row?.user_email || target;
      const newBalance = row?.new_balance ?? '?';
      Alert.alert(
        'Готово',
        `+${amount} → ${name}\nБаланс: ${newBalance}\n(${ms} мс)`
      );
      haptic.success();
      setAdminTopUpTarget('');
    } catch (e) {
      console.log('[admin_top_up] catch', e);
      Alert.alert(
        'Ошибка',
        `${e?.message || 'unknown'}\n(${Date.now() - startedAt} мс)`
      );
    } finally {
      setAdminTopUpBusy(false);
    }
  };

  const addHabit = async () => {
    if (!habitTitle.trim()) return;
    const newHabit = {
      id: Date.now().toString(),
      title: habitTitle.trim(),
      description: habitDescription.trim(),
      category: habitCategory,
      frequency: habitFrequency,
      priority: habitPriority,
      progress: 0,
      reminderEnabled: notificationsEnabled,
      reminderHour,
      reminderMinute,
    };
    setHabits((prev) => [newHabit, ...prev]);
    setHabitTitle('');
    setHabitDescription('');
    setHabitCategory('health');
    setHabitFrequency('daily');
    setHabitPriority('medium');
    haptic.medium();
    if (notificationsEnabled) {
      await scheduleHabitReminder({
        habitId: newHabit.id,
        title: newHabit.title,
        body: newHabit.description || t('habits.remind'),
        hours: reminderHour,
        minutes: reminderMinute,
      });
    }
  };

  const removeHabit = async (id) => {
    setHabits((prev) => prev.filter((habit) => habit.id !== id));
    await cancelHabitReminder(id);
    haptic.warning();
  };

  const incrementHabit = (id) => {
    const habit = habits.find((h) => h.id === id);
    if (!habit) return;
    markHabitDone(habit);
  };

  const joinChallenge = async () => {
    setGroupError('');
    if (!isSupabaseConfigured || !supabase || !currentUserId) {
      const message = t('errors.challengeNeedAuth');
      setGroupError(message);
      showToast('warning', message);
      return;
    }

    if (isJoined) {
      const msgJoined = t('errors.challengeAlreadyIn');
      setGroupError(msgJoined);
      showToast('warning', t('errors.challengeInList'));
      return;
    }

    if (participants.length >= MAX_PARTICIPANTS) {
      const msgFull = t('errors.challengeFull');
      setGroupError(msgFull);
      showToast('warning', msgFull);
      return;
    }

    const trimmedName = nickname.trim() || loginName.trim();
    if (!trimmedName) {
      const msgNick = t('errors.nicknameRequired');
      setGroupError(msgNick);
      showToast('error', msgNick);
      return;
    }

    const exists = participants.some(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (exists) {
      const msgTaken = t('errors.nicknameTaken');
      setGroupError(msgTaken);
      showToast('warning', msgTaken);
      return;
    }

    if (balance < ENTRY_FEE) {
      setGroupError(t('errors.balanceLowDetail'));
      showToast('error', t('errors.balanceLow'));
      return;
    }

    setIsJoiningChallenge(true);
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('join_weekly_challenge', {
          participant_name: trimmedName,
          target_week_start: weeklyStartKey,
          required_entry_fee: ENTRY_FEE,
          max_participants: MAX_PARTICIPANTS,
        }),
        12000
      );

      if (error) {
        const message = getJoinChallengeErrorMessage(error, language);
        setGroupError(message);
        showToast('error', message);
        const recoveredParticipant = await recoverJoinedParticipant();
        if (!recoveredParticipant) {
          setGroupError(message);
        }
        return;
      }

      const { participant: joinedParticipant, newBalance } =
        normalizeJoinChallengeResponse(
          data,
          currentUserId,
          trimmedName,
          ENTRY_FEE
        );

      if (!joinedParticipant) {
        const recoveredParticipant = await recoverJoinedParticipant();
        if (!recoveredParticipant) {
          const message = t('errors.joinNotConfirmed');
          await loadProfileBalance();
          setGroupError(message);
          showToast('error', message);
        }
        return;
      }

      if (typeof newBalance === 'number') {
        setBalance(newBalance);
      } else {
        loadProfileBalance();
      }
      setMyParticipantId(joinedParticipant.id);
      setParticipants((prev) => {
        const withoutDuplicate = prev.filter(
          (participant) =>
            participant.id !== joinedParticipant.id &&
            participant.userId !== currentUserId
        );
        return [...withoutDuplicate, joinedParticipant].sort(
          (first, second) => first.joinedAt - second.joinedAt
        );
      });
      setNickname('');
      setTotalBets((prevTotal) => {
        const nextStats = getNextBetStats(prevTotal, averageBet, ENTRY_FEE);
        setAverageBet(nextStats.average);
        return nextStats.total;
      });
      haptic.success();
      showToast('success', t('errors.joinConfirmed'));
      writeFeedEvent('challenge_join', {
        text: t('feed.joinWeek', { fee: ENTRY_FEE }),
      });
      loadWeeklyParticipants();
    } catch (error) {
      console.error('Join challenge failed:', error);
      const message = getJoinChallengeErrorMessage(error, language);
      setGroupError(message);
      showToast('error', message);
      const recoveredParticipant = await recoverJoinedParticipant();
      if (!recoveredParticipant) {
        setGroupError(message);
      }
    } finally {
      setIsJoiningChallenge(false);
    }
  };

  const updateParticipantStatus = (id) => {
    const participant = participants.find((item) => item.id === id);
    if (!participant) return;
    showToast('warning', t('errors.statusAfterWeek'));
  };

  const loadPeerReviews = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || participants.length === 0) {
      setPeerReviews([]);
      return;
    }
    const ids = participants.map((p) => p.id);
    const { data, error } = await supabase
      .from('peer_reviews')
      .select('*')
      .in('participant_id', ids);
    if (error) {
      console.error('Failed to load peer reviews:', error);
      return;
    }
    setPeerReviews(data || []);
  }, [participants]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadPeerReviews();
  }, [isAuthenticated, loadPeerReviews]);

  const reviewsForParticipant = (participantId) =>
    peerReviews.filter((row) => row.participant_id === participantId);

  const myReviewFor = (participantId) =>
    peerReviews.find(
      (row) => row.participant_id === participantId && row.reviewer_id === currentUserId
    );

  const submitPeerReview = async (participant, vote) => {
    if (!isSupabaseConfigured || !supabase || !currentUserId) return;
    if (participant.userId === currentUserId) {
      showToast('warning', t('errors.voteSelf'));
      return;
    }
    const existing = myReviewFor(participant.id);
    if (existing) {
      const { error } = await supabase
        .from('peer_reviews')
        .update({ vote })
        .eq('id', existing.id);
      if (error) {
        console.error('Peer review update failed:', error);
        showToast('error', t('errors.reviewUpdateFailed'));
        return;
      }
    } else {
      const { error } = await supabase.from('peer_reviews').insert({
        reviewer_id: currentUserId,
        participant_id: participant.id,
        vote,
      });
      if (error) {
        console.error('Peer review insert failed:', error);
        showToast('error', t('errors.reviewSendFailed'));
        return;
      }
    }
    haptic.selection();
    showToast(
      'success',
      vote === 'approve' ? t('errors.reviewApprove') : t('errors.reviewDoubt')
    );
    loadPeerReviews();
  };

  const habitDoneToday = (habitId) =>
    completions.some(
      (c) => c.habit_id === habitId && c.done_date === todayKey && c.status === 'done'
    );

  const habitStreak = (habitId) => {
    const dates = completions
      .filter((c) => c.habit_id === habitId && c.status === 'done')
      .map((c) => c.done_date);
    return calculateStreak(dates, todayKey, 1);
  };

  const renderHabit = ({ item }) => {
    const accent =
      HABIT_CATEGORY_COLORS[normalizeCategoryKey(item.category)] || palette.purple;
    const doneToday = habitDoneToday(item.id);
    const { current: streak } = habitStreak(item.id);
    const noteValue = habitNoteDraft[item.id] || '';
    const photoValue = habitPhotoDraft[item.id] || '';
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: cardColor,
            borderColor: borderColor,
            borderLeftWidth: 4,
            borderLeftColor: accent,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: textColor }]}>
            {item.title}
          </Text>
          <TouchableOpacity
            style={[
              styles.habitInlineButton,
              doneToday && { borderColor: '#16A34A' },
            ]}
            onPress={() => incrementHabit(item.id)}
          >
            <Text style={styles.habitInlineButtonText}>
              {doneToday ? t('habits.doneCheck') : t('habits.doneOne')}
            </Text>
          </TouchableOpacity>
        </View>
        {item.description ? (
          <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
            {item.description}
          </Text>
        ) : null}
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t(`habits.categories.${normalizeCategoryKey(item.category)}`)} ·{' '}
          {t(`habits.frequencies.${normalizeFrequencyKey(item.frequency)}`)} ·{' '}
          {t('habits.priorityInline')}{' '}
          {t(`habits.priorities.${normalizePriorityKey(item.priority)}`)}
        </Text>
        <Text style={[styles.progressText, { color: secondaryText }]}>
          🔥 {t('habits.streak')}: {streak} · {t('habits.doneToday')}: {doneToday ? '✅' : '—'} · {item.progress || 0}
        </Text>

        <TextInput
          placeholder={t('habits.addNote')}
          placeholderTextColor={secondaryText}
          value={noteValue}
          onChangeText={(value) =>
            setHabitNoteDraft((prev) => ({ ...prev, [item.id]: value }))
          }
          style={[styles.input, inputThemeStyle, { marginTop: 8 }]}
        />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <TouchableOpacity
            style={styles.smallPurpleButton}
            onPress={() => pickHabitPhoto(item)}
          >
            <Text style={styles.smallPurpleButtonText}>
              📷 {photoValue ? '✓' : t('habits.addPhoto')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.smallPurpleButton}
            onPress={() => setHabitReminderTime(item, 9, 0)}
          >
            <Text style={styles.smallPurpleButtonText}>🔔 09:00</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.smallPurpleButton}
            onPress={() => setHabitReminderTime(item, 19, 0)}
          >
            <Text style={styles.smallPurpleButtonText}>🔔 19:00</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.smallPurpleButton, { borderColor: 'rgba(239,68,68,0.6)' }]}
            onPress={() =>
              Alert.alert(t('habits.deleteTitle'), item.title, [
                { text: t('habits.deleteCancel'), style: 'cancel' },
                {
                  text: t('habits.deleteConfirm'),
                  style: 'destructive',
                  onPress: () => removeHabit(item.id),
                },
              ])
            }
          >
            <Text style={[styles.smallPurpleButtonText, { color: '#FCA5A5' }]}>
              🗑
            </Text>
          </TouchableOpacity>
        </View>
        {photoValue ? (
          <Image
            source={{ uri: photoValue }}
            style={{ marginTop: 8, width: 96, height: 96, borderRadius: 12 }}
          />
        ) : null}
      </View>
    );
  };

  const cycleAvatar = () => {
    setAvatarIndex((prev) => (prev + 1) % avatarOptions.length);
  };

  const pickAvatarImage = async () => {
    try {
      setAvatarError('');
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setAvatarError(t('errors.permissionPhotos'));
        showToast('warning', t('errors.photosDenied'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled) return;
      const selected = result.assets && result.assets[0];
      if (!selected?.uri) {
        setAvatarError(t('errors.pickPhotoError'));
        showToast('error', t('errors.pickPhotoFailed'));
        return;
      }

      setAvatarUri(selected.uri);
      showToast('success', t('errors.avatarUpdated'));
    } catch (error) {
      console.error('Failed to pick avatar image:', error);
      setAvatarError(t('errors.avatarPickError'));
      showToast('error', t('errors.avatarPickError'));
    }
  };

  const renderBackButton = () =>
    null;

  const renderBrandHeader = (subtitle = null, showIcon = true) => (
    <View style={styles.brandHeader}>
      <View style={styles.brandRow}>
        {showIcon ? (
          <Image source={require('./assets/icon.png')} style={styles.brandIcon} />
        ) : null}
        <Text style={styles.brandTitle}>beLLum</Text>
      </View>
      <Text style={styles.brandSubtitle}>{subtitle ?? t('brand.subtitle')}</Text>
    </View>
  );

  const renderScreenTabs = () => {
    const tabs = [
      { id: 'home', label: t('tabs.home'), icon: 'home-outline' },
      { id: 'habits', label: t('tabs.habits'), icon: 'barbell-outline' },
      { id: 'challenge', label: t('tabs.challenge'), icon: 'trophy-outline' },
      { id: 'social', label: t('tabs.social'), icon: 'people-outline' },
      { id: 'profile', label: t('tabs.profile'), icon: 'person-outline' },
      { id: 'help', label: t('tabs.help'), icon: 'help-circle-outline' },
    ];

    return (
      <View style={styles.screenTabsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.screenTabsRow}
        >
          {tabs.map((tab) => {
            const isActive = screen === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[
                  styles.screenTabButton,
                  isActive && styles.screenTabButtonActive,
                ]}
                onPress={() => setScreen(tab.id)}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={tab.icon}
                  size={14}
                  color={isActive ? '#FFFFFF' : '#C7D2FE'}
                />
                <Text
                  style={[
                    styles.screenTabText,
                    isActive && styles.screenTabTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const handleLoginChange = async () => {
    const nextLogin = loginDraft.trim();
    if (!nextLogin) {
      setLoginError(t('errors.loginEmpty'));
      showToast('error', t('errors.loginNotSet'));
      return;
    }
    if (!canChangeLogin) {
      setLoginError(t('errors.loginCooldownDays', { days: loginDaysLeft }));
      showToast('warning', t('errors.loginCooldown'));
      return;
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.updateUser({
        data: { display_name: nextLogin },
      });
      if (error) {
        setLoginError(error.message || t('errors.loginUpdateFailed'));
        showToast('error', t('errors.loginUpdateError'));
        return;
      }
    }

    setLoginName(nextLogin);
    setLastLoginChange(Date.now());
    setLoginError('');
    showToast('success', t('errors.loginUpdated'));
  };

  const handleAuthSubmit = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const isCloudAuthAvailable = isSupabaseConfigured && Boolean(supabase);
      if (!isCloudAuthAvailable) {
        setAuthError(t('errors.supabaseNotConfigured'));
        return;
      }

      if (authMode === 'register') {
        const trimmedName = authName.trim();
        const trimmedEmail = authEmail.trim();
        if (trimmedName.length < 5) {
          setAuthError(t('errors.authDisplayNameShort'));
          return;
        }
        const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
        if (!emailValid) {
          setAuthError(t('errors.authEmailInvalid'));
          return;
        }
        if (!authPassword.trim()) {
          setAuthError(t('errors.authFillPasswordRegister'));
          return;
        }
        const trimmedPassword = authPassword.trim();

        const { data, error } = await signUpWithFallback({
          email: trimmedEmail,
          password: trimmedPassword,
          displayName: trimmedName,
        });

        if (error) {
          setAuthError(getAuthErrorMessage(error, t('errors.authRegisterFallback')));
          return;
        }

        if (!data?.user) {
          setAuthError(t('errors.authNoUser'));
          return;
        }

        setLoginName(trimmedName);
        setLoginDraft(trimmedName);
        setUserEmail(trimmedEmail);
        setLoginInput(trimmedEmail);
        setAuthPassword('');
        if (data.session) {
          await persistFallbackSession(data.session);
          setCurrentUserId(data.user.id);
          setRegisteredAt(data.user.created_at || '');
          setIsProfileReady(false);
          setIsAuthenticated(true);
          setScreen('home');
          showToast('success', t('errors.registerDone'));
        } else {
          if (data.user.identities && data.user.identities.length === 0) {
            setAuthError(t('errors.authExistsLogin'));
          } else {
            setAuthError(t('errors.authCheckEmail'));
          }
          setAuthMode('login');
          showToast('warning', t('errors.checkEmailOrLogin'));
        }
        return;
      }

      const trimmedEmail = loginInput.trim().toLowerCase();
      if (!trimmedEmail) {
        setAuthError(t('errors.authEnterEmail'));
        return;
      }
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
      if (!emailValid) {
        setAuthError(t('errors.authEmailInvalid'));
        return;
      }
      if (!loginPassword.trim()) {
        setAuthError(t('errors.authEnterPassword'));
        return;
      }

      const { data, error } = await signInWithFallback({
        email: trimmedEmail,
        password: loginPassword.trim(),
      });

      if (error) {
        setAuthError(getAuthErrorMessage(error, t('errors.authWrongCreds')));
        return;
      }

      const nextLogin =
        data.user?.user_metadata?.display_name ||
        data.user?.email?.split('@')[0] ||
        '';
      await persistFallbackSession(data.session);
      setLoginName(nextLogin);
      setLoginDraft(nextLogin);
      setUserEmail(data.user?.email || trimmedEmail);
      setCurrentUserId(data.user?.id || null);
      setRegisteredAt(data.user?.created_at || '');
      setIsProfileReady(false);
      setIsAuthenticated(true);
      setScreen('home');
      setLoginPassword('');
      showToast('success', t('errors.loginDone'));
    } catch (error) {
      console.error('Auth submit failed:', error);
      setAuthError(
        getAuthErrorMessage(
          error,
          t('errors.authNetworkGeneric')
        )
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGuestLogin = () => {
    setAuthError('');
    setLoginName(GUEST_DEFAULT_DISPLAY_NAME);
    setLoginDraft(GUEST_DEFAULT_DISPLAY_NAME);
    setUserEmail('');
    setIsAuthenticated(true);
    setScreen('home');
    showToast('warning', t('errors.guestWarn'));
  };

  const handleLogout = async () => {
    await cancelChallengeWeekReminders(weeklyStartKey);
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setAuthError(error.message || t('errors.logoutError'));
        return;
      }
    }
    setIsAuthenticated(false);
    setScreen('home');
    setLoginInput('');
    setLoginPassword('');
    setAuthPassword('');
    setLoginName('');
    setLoginDraft('');
    setUserEmail('');
    setCurrentUserId(null);
    setRegisteredAt('');
    setIsProfileReady(false);
    await clearAuthState();
  };

  const removeChallenge = (challenge) => {
    const allowedMs = DELETE_WINDOW_HOURS * 60 * 60 * 1000;
    if (Date.now() - challenge.createdAt > allowedMs) {
      showToast('warning', t('errors.challengeDeleteWindow'));
      return;
    }
    setChallenges((prev) =>
      prev.filter((item) => item.id !== challenge.id)
    );
    showToast('success', t('errors.challengeDeleted'));
  };

  const updateChallengeStatus = (challengeId, nextStatus) => {
    setChallenges((prev) =>
      prev.map((challenge) => {
        if (challenge.id !== challengeId) return challenge;
        return {
          ...challenge,
          status: nextStatus,
          completedAt: nextStatus === 'active' ? null : Date.now(),
        };
      })
    );
    if (nextStatus === 'success') {
      showToast('success', t('errors.challengeMarkDone'));
    }
    if (nextStatus === 'fail') {
      showToast('warning', t('errors.challengeMarkFail'));
    }
  };

  const applyChallengeFilter = (filter) => {
    setChallengeFilter(filter);
    setChallengePage(1);
  };

  const finalizeWeek = async () => {
    if (weeklyOutcome) return;
    setGroupError('');
    if (!isJoined) {
      const m = t('errors.weekJoinFirst');
      setGroupError(m);
      showToast('warning', m);
      return;
    }
    if (!canFinalizeWeek) {
      const m = t('errors.weekNotOver');
      setGroupError(m);
      showToast('warning', m);
      return;
    }

    const outcome = 'success';
    if (isSupabaseConfigured && supabase && currentUserId && myParticipantId) {
      const { error } = await supabase
        .from('weekly_challenge_participants')
        .update({ status: outcome })
        .eq('id', myParticipantId)
        .eq('user_id', currentUserId);

      if (error) {
        console.error('Failed to finalize weekly challenge:', error);
        const mf = t('errors.weekFinalizeFailed');
        setGroupError(mf);
        showToast('error', mf);
        return;
      }
    }

    setWeeklyOutcome(outcome);
    setParticipants((prev) =>
      prev.map((participant) =>
        participant.id === myParticipantId
          ? { ...participant, status: outcome }
          : participant
      )
    );
    const challengeXp = xpForChallengeOutcome(outcome);
    if (challengeXp > 0) {
      setXp((prev) => prev + challengeXp);
    }
    if (outcome === 'success') {
      const reward = Math.round(ENTRY_FEE * prizeMultiplier(levelInfo.level));
      setBalance((prev) => prev + reward);
      haptic.success();
      showToast('success', t('errors.weekSuccess', { xp: challengeXp, rub: reward }));
      writeFeedEvent('challenge_win', {
        text: t('feed.winWeek', { xp: challengeXp }),
      });
    } else {
      haptic.error();
      showToast('error', t('errors.weekFail'));
      writeFeedEvent('challenge_fail', { text: t('feed.failWeek') });
    }
    loadWeeklyParticipants();
  };

  const resetWeeklyChallenge = () => {
    const newStart = getWeekStartDate();
    setWeeklyStartAt(newStart);
    setWeeklyExercises(pickWeeklyExercises(EXERCISE_KEYS));
    setWeeklyOutcome(null);
    setParticipants([]);
    setMyParticipantId(null);
    setNickname('');
    setGroupError('');
    showToast('success', t('errors.weekNew'));
  };

  const topUpBalance = (amount) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBalance((prev) => prev + amount);
    showToast('success', t('errors.topUpPaid', { amount }));
  };

  const openTopUpScreen = () => {
    setTopUpInvoice(null);
    setTopUpStatus('idle');
    setTopUpAmount('');
    topUpPollAbortRef.current = false;
    setScreen('topup');
  };

  const handleTopUpRegionChange = (nextRegion) => {
    setTopUpRegion(nextRegion);
    setTopUpAmount('');
  };

  const startTopUpInvoice = async (rawAmount) => {
    if (!isSupabaseConfigured || !supabase) {
      showToast('error', t('errors.topUpNotConfigured'));
      return;
    }
    if (!isAuthenticated || !currentUserId) {
      showToast('warning', t('errors.topUpLoginFirst'));
      return;
    }
    const amount = sanitizeTopUpAmount(rawAmount ?? topUpAmount);
    if (!amount) {
      showToast('warning', t('errors.topUpAmount'));
      return;
    }
    const cfg = defaultsForRegion(topUpRegion);
    setTopUpLoading(true);
    setTopUpStatus('creating');
    try {
      const invoice = await createTopUpInvoice({
        supabase,
        amount,
        currency: cfg.currency,
        region: topUpRegion,
      });
      setTopUpInvoice(invoice);
      setTopUpStatus('pending');
      haptic.selection();
      try {
        await Linking.openURL(invoice.pay_url);
      } catch (_e) {
        showToast('warning', t('errors.topUpPayOpenFailed'));
      }
      topUpPollAbortRef.current = false;
      pollInvoice({
        supabase,
        invoiceId: invoice.invoice_id,
        intervalMs: 5000,
        timeoutMs: 30 * 60 * 1000,
        onTick: ({ row }) => {
          if (topUpPollAbortRef.current) return;
          if (row?.status) setTopUpStatus(row.status);
        },
      })
        .then((finalRow) => {
          if (topUpPollAbortRef.current) return;
          if (finalRow?.status === 'paid') {
            haptic.success();
            const credited = (finalRow.balance_amount_minor || 0) / 100;
            showToast('success', t('errors.topUpPaid', { amount: credited }));
            setTopUpStatus('paid');
            loadProfileBalance();
          } else if (finalRow?.status === 'expired' || finalRow?.status === 'timeout') {
            setTopUpStatus('expired');
            showToast('warning', t('errors.topUpExpired'));
          } else if (finalRow?.status === 'failed' || finalRow?.status === 'cancelled') {
            setTopUpStatus(finalRow.status);
            showToast('error', t('errors.topUpFailed'));
          }
        })
        .catch((err) => {
          console.error('pollInvoice failed:', err);
        });
    } catch (e) {
      console.error('createInvoice failed:', e);
      const msg = String(e?.message || e);
      if (msg.includes('amount_out_of_range')) {
        showToast('warning', t('errors.topUpRange'));
      } else if (msg.includes('amount_too_small')) {
        showToast('warning', t('errors.topUpSmall'));
      } else {
        showToast('error', t('errors.topUpInvoiceFail'));
      }
      setTopUpStatus('idle');
    } finally {
      setTopUpLoading(false);
    }
  };

  const cancelTopUp = () => {
    topUpPollAbortRef.current = true;
    setTopUpInvoice(null);
    setTopUpStatus('idle');
    setTopUpAmount('');
  };

  const refreshTopUpStatus = async () => {
    if (!topUpInvoice?.invoice_id) return;
    const row = await fetchInvoiceStatus({
      supabase,
      invoiceId: topUpInvoice.invoice_id,
    });
    if (!row) return;
    setTopUpStatus(row.status);
    if (row.status === 'paid') {
      const credited = (row.balance_amount_minor || 0) / 100;
      showToast('success', t('errors.topUpPaid', { amount: credited }));
      loadProfileBalance();
      topUpPollAbortRef.current = true;
    }
  };

  const formatShortDate = (date) =>
    date.toLocaleDateString(localeTag, { day: '2-digit', month: '2-digit' });

  const toastStyles = {
    success: { background: '#DCFCE7', border: '#16A34A', text: '#14532D' },
    warning: { background: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
    error: { background: '#FEE2E2', border: '#DC2626', text: '#991B1B' },
  };

  const renderAuthScreen = () => (
    <View style={styles.section}>
      <View style={styles.logoContainer}>
        <Image source={require('./assets/icon.png')} style={styles.appIcon} />
      </View>
      <Text style={[styles.homeTitle, styles.appNameTitle, { marginTop: 16 }]}>
        beLLum
      </Text>
      <Text style={[styles.sectionSubtitle, { color: secondaryText, marginTop: 8 }]}>
        {t('auth.subtitle')}
      </Text>

      <View
        style={[
          styles.inputCard,
          { borderColor: 'transparent' },
        ]}
      >
        <View style={styles.authToggleRow}>
          <TouchableOpacity
            style={[
              styles.authToggleButton,
              authMode === 'register' && styles.authToggleActive,
            ]}
            onPress={() => {
              setAuthMode('register');
              setAuthError('');
            }}
          >
            <Text
              style={[
                styles.authToggleText,
                authMode === 'register' && styles.authToggleTextActive,
              ]}
            >
              {t('auth.register')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.authToggleButton,
              authMode === 'login' && styles.authToggleActive,
            ]}
            onPress={() => {
              setAuthMode('login');
              setAuthError('');
            }}
          >
            <Text
              style={[
                styles.authToggleText,
                authMode === 'login' && styles.authToggleTextActive,
              ]}
            >
              {t('auth.login')}
            </Text>
          </TouchableOpacity>
        </View>

        {authMode === 'register' ? (
          <>
            <TextInput
              placeholder={t('auth.placeholderLogin')}
              placeholderTextColor={secondaryText}
              value={authName}
              onChangeText={setAuthName}
              style={[styles.input, inputThemeStyle]}
            />

            <TextInput
              placeholder={t('auth.placeholderEmail')}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor={secondaryText}
              value={authEmail}
              onChangeText={setAuthEmail}
              style={[styles.input, inputThemeStyle]}
            />

            <TextInput
              placeholder={t('auth.placeholderPassword')}
              secureTextEntry
              placeholderTextColor={secondaryText}
              value={authPassword}
              onChangeText={setAuthPassword}
              style={[styles.input, inputThemeStyle]}
            />
          </>
        ) : (
          <>
            <TextInput
              placeholder={t('auth.placeholderEmail')}
              placeholderTextColor={secondaryText}
              value={loginInput}
              onChangeText={setLoginInput}
              style={[styles.input, inputThemeStyle]}
              autoCapitalize="none"
            />
            <TextInput
              placeholder={t('auth.placeholderPassword')}
              secureTextEntry
              placeholderTextColor={secondaryText}
              value={loginPassword}
              onChangeText={setLoginPassword}
              style={[styles.input, inputThemeStyle]}
            />
          </>
        )}

        {authError ? (
          <Text style={[styles.authErrorText, { color: '#DC2626' }]}>
            {authError}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, authLoading && styles.disabledButton]}
          onPress={handleAuthSubmit}
          disabled={authLoading}
        >
          <Text style={styles.primaryButtonText}>
            {authLoading
              ? t('common.wait')
              : authMode === 'register'
              ? t('auth.submitRegister')
              : t('auth.submitLogin')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleGuestLogin}
          disabled={authLoading}
        >
          <Text style={styles.secondaryButtonText}>{t('auth.guest')}</Text>
        </TouchableOpacity>

        <Text style={[styles.authHintText, { color: secondaryText }]}>
          {isSupabaseConfigured ? t('auth.hintSupabaseOk') : t('auth.hintSupabaseMissing')}
        </Text>
      </View>
    </View>
  );

  const renderHome = () => (
    <View style={styles.section}>
      {renderBrandHeader(undefined, false)}

      <AnimatedCard style={styles.heroCard}>
        <Text style={styles.heroTitle}>{t('home.heroTitle')}</Text>
        <Text style={styles.heroSubtitle}>{t('home.heroSubtitle')}</Text>

        <GradientButton
          label={t('home.menuHabits')}
          iconName="barbell-outline"
          onPress={() => {
            setScreen('habits');
          }}
          style={styles.heroButton}
        />
        <GradientButton
          label={t('home.menuChallenge')}
          iconName="trophy-outline"
          onPress={() => {
            setScreen('challenge');
          }}
          style={styles.heroButton}
        />
        <GradientButton
          label={t('home.menuProfile')}
          iconName="person-circle-outline"
          onPress={() => setScreen('profile')}
          style={styles.heroButton}
        />
        <GradientButton
          label={t('home.menuHelp')}
          iconName="help-circle-outline"
          onPress={() => setScreen('help')}
          style={styles.heroButton}
        />
        <GradientButton
          label={t('home.menuWebVersion')}
          iconName="globe-outline"
          onPress={() => {
            haptic.selection();
            setScreen('weblanding');
          }}
          style={styles.heroButton}
        />
      </AnimatedCard>

      <Text style={styles.footerTiny}>{t('home.footer')}</Text>
    </View>
  );

  const renderHabitsScreen = () => (
    <View style={styles.section}>
      {renderBackButton()}
      <Text style={[styles.sectionTitle, { color: textColor }]}>
        {t('habits.title')}
      </Text>
      <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
        {t('habits.subtitle')}
      </Text>

      <View style={[styles.inputCard, styles.habitsTransparentCard]}>
        <TextInput
          placeholder={t('habits.placeholderTitle')}
          placeholderTextColor={secondaryText}
          value={habitTitle}
          onChangeText={setHabitTitle}
          style={[styles.input, inputThemeStyle]}
        />
        <TextInput
          placeholder={t('habits.placeholderDesc')}
          placeholderTextColor={secondaryText}
          value={habitDescription}
          onChangeText={setHabitDescription}
          style={[styles.input, inputThemeStyle]}
        />
        <Text style={[styles.formLabel, { color: textColor }]}>{t('habits.labelCategory')}</Text>
        <View style={styles.optionRow}>
          {HABIT_CATEGORY_IDS.map((option) => {
            const isSelected = habitCategory === option;
            return (
              <TouchableOpacity
                key={`habit-category-${option}`}
                style={[
                  styles.optionChip,
                  styles.habitOptionChip,
                  isSelected && styles.habitOptionChipActive,
                ]}
                onPress={() => setHabitCategory(option)}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    isSelected && styles.optionChipTextActive,
                  ]}
                >
                  {t(`habits.categories.${option}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.formLabel, { color: textColor }]}>{t('habits.labelFrequency')}</Text>
        <View style={styles.optionRow}>
          {HABIT_FREQUENCY_IDS.map((option) => {
            const isSelected = habitFrequency === option;
            return (
              <TouchableOpacity
                key={`habit-frequency-${option}`}
                style={[
                  styles.optionChip,
                  styles.habitOptionChip,
                  isSelected && styles.habitOptionChipActive,
                ]}
                onPress={() => setHabitFrequency(option)}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    isSelected && styles.optionChipTextActive,
                  ]}
                >
                  {t(`habits.frequencies.${option}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.formLabel, { color: textColor }]}>{t('habits.labelPriority')}</Text>
        <View style={styles.optionRow}>
          {HABIT_PRIORITY_IDS.map((option) => {
            const isSelected = habitPriority === option;
            return (
              <TouchableOpacity
                key={`habit-priority-${option}`}
                style={[
                  styles.optionChip,
                  styles.habitOptionChip,
                  isSelected && styles.habitOptionChipActive,
                ]}
                onPress={() => setHabitPriority(option)}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    isSelected && styles.optionChipTextActive,
                  ]}
                >
                  {t(`habits.priorities.${option}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <GradientButton
          label={t('habits.addButton')}
          iconName="add-circle-outline"
          onPress={addHabit}
          style={styles.habitsCreateButton}
          buttonStyle={styles.habitTransparentButton}
        />
      </View>

      {habits.length === 0 ? (
        <Text style={[styles.emptyText, { color: secondaryText }]}>
          {t('habits.empty')}
        </Text>
      ) : (
        <FlatList
          data={habits}
          keyExtractor={(item) => item.id}
          renderItem={renderHabit}
          scrollEnabled={false}
        />
      )}
    </View>
  );

  const renderChallengeScreen = () => (
    <View style={styles.section}>
      {renderBackButton()}
      {renderBrandHeader()}
      <>
          <TouchableOpacity style={styles.weekBanner} activeOpacity={0.9}>
            <Text style={styles.weekBannerText}>{t('challenge.banner')}</Text>
          </TouchableOpacity>

          <View style={[styles.card, { backgroundColor: cardColor }]}>
            <Text style={[styles.listTitle, { color: textColor }]}>
              {t('challenge.allTitle')}
            </Text>
            <View style={styles.sectionUnderline} />
            <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
              {t('challenge.maxActive')}
            </Text>

        <View style={styles.filterRow}>
          {[
            { id: 'all', label: t('challenge.filterAll') },
            { id: 'active', label: t('challenge.filterActive') },
            { id: 'success', label: t('challenge.filterSuccess') },
            { id: 'fail', label: t('challenge.filterFail'), fullWidth: true },
          ].map((item) => {
            const isSelected = challengeFilter === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.filterButton,
                  item.fullWidth && styles.filterButtonFull,
                  isSelected && styles.filterButtonActive,
                ]}
                onPress={() => applyChallengeFilter(item.id)}
              >
                <Text
                  style={[
                    styles.filterButtonText,
                    isSelected && styles.filterButtonTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {paginatedChallenges.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateIcon}>📋</Text>
            <Text style={[styles.emptyStateTitle, { color: textColor }]}>
              {t('challenge.emptyTitle')}
            </Text>
            <Text style={[styles.emptyStateSubtitle, { color: secondaryText }]}>
              {t('challenge.emptySubtitle')}
            </Text>
          </View>
        ) : (
          <View>
            {paginatedChallenges.map((challenge) => {
              const canDelete =
                Date.now() - challenge.createdAt <=
                DELETE_WINDOW_HOURS * 60 * 60 * 1000;
              return (
                <AnimatedCard key={challenge.id} style={styles.challengeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: textColor }]}>
                      {challenge.exercise}
                    </Text>
                    <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
                      {t('challenge.repsLine', {
                        reps: challenge.repsTime,
                        sets: challenge.sets,
                        perWeek: challenge.perWeek,
                      })}
                    </Text>
                    <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
                      {t('challenge.betLine', { bet: challenge.bet })}{' '}
                      {challenge.failMode === 'charity'
                        ? t('challenge.failCharity')
                        : t('challenge.failPool')}
                    </Text>
                    <View style={styles.challengeStatusRow}>
                      {['active', 'success', 'fail'].map((status) => {
                        const isActive = challenge.status === status;
                        const label =
                          status === 'active'
                            ? t('challenge.statusActive')
                            : status === 'success'
                            ? t('challenge.statusSuccess')
                            : t('challenge.statusFail');
                        return (
                          <TouchableOpacity
                            key={`${challenge.id}-${status}`}
                            style={[
                              styles.statusChip,
                              isActive && styles.statusChipActive,
                            ]}
                            onPress={() => updateChallengeStatus(challenge.id, status)}
                          >
                            <Text
                              style={[
                                styles.statusChipText,
                                isActive && styles.statusChipTextActive,
                              ]}
                            >
                              {label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.smallPurpleButton,
                      !canDelete && styles.disabledSmallButton,
                    ]}
                    onPress={() => removeChallenge(challenge)}
                    disabled={!canDelete}
                  >
                    <Text style={styles.smallPurpleButtonText}>
                      {canDelete ? t('common.delete') : t('common.hoursLocked')}
                    </Text>
                  </TouchableOpacity>
                </AnimatedCard>
              );
            })}
          </View>
        )}

        {totalPages > 1 ? (
          <View style={styles.paginationRow}>
            <TouchableOpacity
              style={[
                styles.smallOutlineButton,
                safePage === 1 && styles.disabledSmallButton,
              ]}
              onPress={() => setChallengePage(Math.max(1, safePage - 1))}
              disabled={safePage === 1}
            >
              <Text style={[styles.smallOutlineButtonText, { color: PURPLE }]}>
                {t('common.back')}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
              {t('common.pageOf', { page: safePage, total: totalPages })}
            </Text>
            <TouchableOpacity
              style={[
                styles.smallOutlineButton,
                safePage === totalPages && styles.disabledSmallButton,
              ]}
              onPress={() => setChallengePage(Math.min(totalPages, safePage + 1))}
              disabled={safePage === totalPages}
            >
              <Text style={[styles.smallOutlineButtonText, { color: PURPLE }]}>
                {t('common.forward')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
          <Text style={[styles.sectionTitle, { color: textColor, marginTop: 8 }]}>
            {t('challenge.weeklyTitle')}
          </Text>
          <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
            {t('challenge.weeklySubtitle', { days: WEEK_LENGTH_DAYS })}
          </Text>

          <View style={[styles.card, { backgroundColor: cardColor }]}>
            <Text style={[styles.cardTitle, { color: textColor }]}>
              {t('challenge.weekCardTitle')}
            </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('challenge.weekStart', { date: formatShortDate(weeklyStartAt) })}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('challenge.weekEnd', { date: formatShortDate(weeklyEndAt) })}
        </Text>

        <Text style={[styles.cardTitle, { color: palette.purple, marginTop: 10 }]}>
          ⏳ До конца недели:{' '}
          {Math.floor(weeklyRemainingMs / 86400000)}д{' '}
          {Math.floor((weeklyRemainingMs % 86400000) / 3600000)}ч{' '}
          {Math.floor((weeklyRemainingMs % 3600000) / 60000)}м{' '}
          {Math.floor((weeklyRemainingMs % 60000) / 1000)}с
        </Text>

        <View style={styles.sectionUnderline} />
        {weeklyTask ? (
          <>
            <Text style={[styles.cardTitle, { color: textColor, marginTop: 8 }]}>
              📋 {weeklyTask.title}
            </Text>
            <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
              {weeklyTask.description}
            </Text>
          </>
        ) : (
          <Text style={[styles.cardSubtitle, { color: secondaryText, marginTop: 8 }]}>
            Задание недели ещё не задано администратором.
          </Text>
        )}
      </View>

      <View style={styles.inputCard}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          {t('challenge.joinCardTitle')}
        </Text>
        <TextInput
          placeholder={t('challenge.nicknamePlaceholder')}
          placeholderTextColor={secondaryText}
          value={nickname}
          onChangeText={(value) => {
            setNickname(value);
            setGroupError('');
          }}
          style={[styles.input, inputThemeStyle]}
        />
        {groupError ? (
          <Text style={[styles.authErrorText, { color: '#DC2626' }]}>
            {groupError}
          </Text>
        ) : null}
        <TouchableOpacity
          style={[
            styles.primaryButton,
            (participants.length >= MAX_PARTICIPANTS ||
              isJoined ||
              isJoiningChallenge) &&
              styles.disabledButton,
          ]}
          onPress={joinChallenge}
          disabled={
            participants.length >= MAX_PARTICIPANTS || isJoined || isJoiningChallenge
          }
        >
          <Text style={styles.primaryButtonText}>
            {isJoiningChallenge
              ? t('challenge.joinWait')
              : isJoined
              ? t('challenge.joinAlready')
              : participants.length >= MAX_PARTICIPANTS
              ? t('challenge.joinFullBtn')
              : t('challenge.joinFor', { fee: ENTRY_FEE })}
          </Text>
        </TouchableOpacity>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              {t('challenge.statParticipants')}
            </Text>
            <Text style={[styles.statValue, { color: textColor }]}>
              {participants.length} / {MAX_PARTICIPANTS}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              {t('challenge.statPrize')}
            </Text>
            <Text style={[styles.statValue, { color: textColor }]}>
              {prizePool} ₽
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              {t('challenge.statBase')}
            </Text>
            <Text style={[styles.statValueSmall, { color: textColor }]}>
              {BASE_PRIZE} ₽
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              {t('challenge.statWinners')}
            </Text>
            <Text style={[styles.statValueSmall, { color: textColor }]}>
              {winnersCount || 0}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              {t('challenge.statEntry')}
            </Text>
            <Text style={[styles.statValueSmall, { color: textColor }]}>
              {ENTRY_FEE} ₽
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              {t('challenge.statPayout')}
            </Text>
            <Text style={[styles.statValueSmall, { color: textColor }]}>
              {payoutPerWinner} ₽
            </Text>
          </View>
        </View>

        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('challenge.joinHint')}
        </Text>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            (!canFinalizeWeek || !isJoined || weeklyOutcome) &&
              styles.disabledButton,
          ]}
          onPress={finalizeWeek}
          disabled={!canFinalizeWeek || !isJoined || weeklyOutcome}
        >
          <Text style={styles.primaryButtonText}>
            {weeklyOutcome
              ? t('challenge.finalizeDone')
              : canFinalizeWeek
              ? t('challenge.finalizeReady')
              : t('challenge.finalizeWait')}
          </Text>
        </TouchableOpacity>

        {weekEnded ? (
          <TouchableOpacity
            style={styles.smallOutlineButton}
            onPress={resetWeeklyChallenge}
          >
            <Text style={[styles.smallOutlineButtonText, { color: PURPLE }]}>
              {t('challenge.newWeek')}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: textColor }]}>
            {t('challenge.participantsTitle')}
          </Text>
        </View>

        {participants.length === 0 ? (
          <Text
            style={[
              styles.emptyText,
              { color: secondaryText, marginTop: 4 },
            ]}
          >
            {t('challenge.noParticipants')}
          </Text>
        ) : (
          <View>
            {participants.map((participant, index) => {
              const reviews = reviewsForParticipant(participant.id);
              const approveCount = reviews.filter((r) => r.vote === 'approve').length;
              const rejectCount = reviews.filter((r) => r.vote === 'reject').length;
              const myVote = myReviewFor(participant.id)?.vote;
              return (
                <View
                  key={participant.id}
                  style={{
                    paddingVertical: 8,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: borderColor,
                  }}
                >
                  <View style={styles.participantRow}>
                    <Text
                      style={[styles.participantIndex, { color: secondaryText }]}
                    >
                      #{index + 1}
                    </Text>
                    <Text style={[styles.participantName, { color: textColor }]}>
                      {participant.name}
                      {participant.isMe ? t('challenge.youTag') : ''}
                    </Text>
                    <TouchableOpacity
                      style={styles.statusBadge}
                      onPress={() => updateParticipantStatus(participant.id)}
                      disabled={participant.isMe}
                    >
                      <Text style={styles.statusBadgeText}>
                        {participant.status === 'success'
                          ? t('challenge.participantSuccess')
                          : participant.status === 'fail'
                          ? t('challenge.participantFail')
                          : t('challenge.participantInProgress')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {!participant.isMe ? (
                    <View
                      style={{ flexDirection: 'row', gap: 6, marginTop: 6, marginLeft: 26 }}
                    >
                      <TouchableOpacity
                        onPress={() => submitPeerReview(participant, 'approve')}
                        style={[
                          styles.smallPurpleButton,
                          myVote === 'approve' && { borderColor: '#16A34A' },
                        ]}
                      >
                        <Text style={styles.smallPurpleButtonText}>
                          👍 {approveCount}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => submitPeerReview(participant, 'reject')}
                        style={[
                          styles.smallPurpleButton,
                          myVote === 'reject' && { borderColor: '#DC2626' },
                        ]}
                      >
                        <Text style={styles.smallPurpleButtonText}>
                          🚩 {rejectCount}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text
                      style={{
                        marginLeft: 26,
                        marginTop: 4,
                        color: secondaryText,
                        fontSize: 11,
                      }}
                    >
                      👍 {approveCount} · 🚩 {rejectCount}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          {t('challenge.historyTitle')}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('challenge.historySubtitle')}
        </Text>
        {weeklyHistoryStats.total > 0 ? (
          <Text style={{ color: secondaryText, fontSize: 12, marginTop: 8 }}>
            {t('challenge.historyTotal', { n: weeklyHistoryStats.total })} ·{' '}
            {t('challenge.historyWins', { n: weeklyHistoryStats.wins })} ·{' '}
            {t('challenge.historyFails', { n: weeklyHistoryStats.fails })}
            {weeklyHistoryStats.winRate != null
              ? ` · ${t('challenge.historyWinRate', { pct: weeklyHistoryStats.winRate })}`
              : ''}
          </Text>
        ) : null}
        <Text
          style={{
            color: secondaryText,
            fontSize: 11,
            marginTop: weeklyHistoryStats.total > 0 ? 10 : 8,
          }}
        >
          {t('challenge.historyChartCaption')}
        </Text>
        <ChallengeWeekHistory
          weeks={weeklyHistoryStats.chartWeeks}
          mutedColor={secondaryText}
          t={t}
        />
      </View>
      </>
    </View>
  );

  const renderProfileScreen = () => (
    <View style={styles.section}>
      {renderBackButton()}
      {renderBrandHeader()}
      <Text style={[styles.sectionTitle, { color: textColor }]}>
        {t('profile.title')}
      </Text>
      <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
        {t('profile.subtitle')}
      </Text>

      {/* XP / level / streaks */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: cardColor,
            borderColor: palette.borderStrong,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              borderWidth: 2,
              borderColor: palette.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: textColor, fontWeight: '900', fontSize: 18 }}>
              {levelInfo.level}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: textColor, fontWeight: '800' }}>
              {t('profile.level')} {levelInfo.level}
            </Text>
            <Text style={{ color: secondaryText, fontSize: 12 }}>
              {t('profile.xpLine', { xp, next: levelInfo.nextLevelXp })}
            </Text>
            <View
              style={{
                height: 6,
                borderRadius: 999,
                backgroundColor: 'rgba(148,163,184,0.25)',
                marginTop: 6,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.round((levelInfo.progress || 0) * 100)}%`,
                  height: '100%',
                  backgroundColor: palette.purple,
                }}
              />
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: secondaryText, fontSize: 11 }}>
              🔥 {t('profile.currentStreak')}
            </Text>
            <Text style={{ color: textColor, fontWeight: '800', fontSize: 18 }}>
              {overallStreak.current}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: secondaryText, fontSize: 11 }}>
              ⚡ {t('profile.bestStreak')}
            </Text>
            <Text style={{ color: textColor, fontWeight: '800', fontSize: 18 }}>
              {overallBestStreak}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: secondaryText, fontSize: 11 }}>
              💎 {t('profile.prizeMultiplierLabel')}
            </Text>
            <Text style={{ color: textColor, fontWeight: '800', fontSize: 18 }}>
              x{prizeMultiplier(levelInfo.level).toFixed(2)}
            </Text>
          </View>
        </View>
      </View>

      {/* Activity heatmap */}
      <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          📅 {t('profile.heatmap')}
        </Text>
        <View style={{ marginTop: 8 }}>
          <HeatmapCalendar
            doneByDate={doneByDate}
            weeks={13}
            baseColor={palette.purple}
            emptyColor={isDark ? 'rgba(148,163,184,0.15)' : 'rgba(15,23,42,0.08)'}
            textColor={secondaryText}
            lessLabel={t('heatmap.less')}
            moreLabel={t('heatmap.more')}
          />
        </View>
      </View>

      {/* Weekday bar chart */}
      <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          📊 {t('profile.weekday')}
        </Text>
        <View style={{ marginTop: 8 }}>
          <WeeklyBarChart
            values={weekdayCounts}
            barColor={palette.purple}
            textColor={secondaryText}
            language={language}
          />
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <View style={styles.profileHeader}>
          <View style={styles.avatarCircle}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>
                {avatarOptions[avatarIndex]}
              </Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: textColor }]}>
              {t('profile.avatarTitle')}
            </Text>
            <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
              {t('profile.avatarSubtitle')}
            </Text>
            <View style={styles.avatarButtonsRow}>
              <TouchableOpacity
                style={styles.smallOutlineButton}
                onPress={pickAvatarImage}
              >
                <Text style={[styles.smallOutlineButtonText, { color: PURPLE }]}>
                  {t('profile.uploadPhoto')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.smallOutlineButton}
                onPress={() => setAvatarUri('')}
              >
                <Text style={[styles.smallOutlineButtonText, { color: PURPLE }]}>
                  {t('profile.resetPhoto')}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.smallGhostButton}
              onPress={cycleAvatar}
            >
              <Text style={[styles.smallGhostButtonText, { color: PURPLE }]}>
                {t('profile.changeEmoji')}
              </Text>
            </TouchableOpacity>
            {avatarError ? (
              <Text style={[styles.authErrorText, { color: '#DC2626' }]}>
                {avatarError}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          {t('profile.loginSection')}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('profile.loginHint')}
        </Text>

        <TextInput
          placeholder={t('profile.loginPlaceholder')}
          placeholderTextColor={secondaryText}
          value={loginDraft}
          onChangeText={(value) => {
            setLoginDraft(value);
            setLoginError('');
          }}
          style={[styles.input, inputThemeStyle]}
        />

        {loginError ? (
          <Text style={[styles.authErrorText, { color: '#DC2626' }]}>
            {loginError}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[
            styles.primaryButton,
            !canChangeLogin && styles.disabledButton,
          ]}
          onPress={handleLoginChange}
          disabled={!canChangeLogin}
        >
          <Text style={styles.primaryButtonText}>
            {canChangeLogin
              ? t('profile.saveLogin')
              : t('profile.loginCooldown', { days: loginDaysLeft })}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('profile.currentLogin')} {loginName || t('profile.notSet')}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('profile.accountEmail')} {userEmail || t('profile.emailMissing')}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('profile.registeredAt')} {formatRegisteredAt(registeredAt)}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('profile.accountBalance')} {balance} ₽
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          {t('profile.statsTitle')}
        </Text>
        <Text style={[styles.statsHeroValue, { color: PURPLE }]}>
          {personalTotal}
        </Text>
        <Text style={[styles.statsHeroLabel, { color: secondaryText }]}>
          {t('profile.statsTotalChallenges')}
        </Text>

        <View style={styles.statsGrid}>
          <View style={[styles.statsTile, styles.statsTileSuccess]}>
            <Text style={[styles.statsTileValue, { color: '#10B981' }]}>
              {personalSuccess}
            </Text>
            <Text style={[styles.statsTileLabel, { color: secondaryText }]}>
              {t('profile.statsCompleted')}
            </Text>
          </View>
          <View style={[styles.statsTile, styles.statsTileFail]}>
            <Text style={[styles.statsTileValue, { color: '#EF4444' }]}>
              {personalFail}
            </Text>
            <Text style={[styles.statsTileLabel, { color: secondaryText }]}>
              {t('profile.statsFailed')}
            </Text>
          </View>
          <View style={[styles.statsTile, styles.statsTileActive]}>
            <Text style={[styles.statsTileValue, { color: PURPLE }]}>
              {personalActive}
            </Text>
            <Text style={[styles.statsTileLabel, { color: secondaryText }]}>
              {t('profile.statsInProgress')}
            </Text>
          </View>
          <View style={[styles.statsTile, styles.statsTileTotal]}>
            <Text style={[styles.statsTileValue, { color: PURPLE }]}>
              {totalDays}
            </Text>
            <Text style={[styles.statsTileLabel, { color: secondaryText }]}>
              {t('profile.statsTotalDays')}
            </Text>
          </View>
        </View>

        <Text style={[styles.statsHeroValue, { color: PURPLE }]}>
          {successPercent}%
        </Text>
        <Text style={[styles.statsHeroLabel, { color: secondaryText }]}>
          {t('profile.statsSuccessRate')}
        </Text>

        <Text style={[styles.statsDetailTitle, { color: textColor }]}>
          {t('profile.statsDetailTitle')}
        </Text>
        <Text style={[styles.profileStatLine, { color: textColor }]}>
          {t('profile.statsDoneDays', { n: doneDays })}
        </Text>
        <Text style={[styles.profileStatLine, { color: textColor }]}>
          {t('profile.statsSkippedDays', { n: failedDays })}
        </Text>
        <Text style={[styles.profileStatLine, { color: textColor }]}>
          {t('profile.statsTotalBets', { n: totalBets })}
        </Text>
        <Text style={[styles.profileStatLine, { color: textColor }]}>
          {t('profile.statsAvgBet', { n: averageBet })}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          {t('profile.balanceTitle')}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('profile.balanceSubtitle')}
        </Text>

        <View style={styles.balanceRow}>
          <Text style={[styles.statLabel, { color: secondaryText }]}>
            {t('profile.currentBalanceLabel')}
          </Text>
          <Text style={[styles.balanceValue, { color: textColor }]}>
            {balance} ₽
          </Text>
        </View>
        <View style={styles.topUpButtonsRow}>
          <TouchableOpacity
            style={[styles.topUpButton, { flex: 1 }]}
            onPress={openTopUpScreen}
          >
            <Text style={styles.topUpButtonText}>{t('profile.topUpOpen')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.cardSubtitle, { color: secondaryText, marginTop: 6, fontSize: 11 }]}>
          {t('profile.balanceFootnote')}
        </Text>
      </View>

      {/* Achievements */}
      <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          🏅 {t('profile.badges')} ({achievements.length}/{Object.keys(ACHIEVEMENT_BY_CODE).length})
        </Text>
        <View style={{ marginTop: 10 }}>
          <BadgeGrid
            unlockedCodes={achievements}
            textColor={textColor}
            mutedColor={secondaryText}
            cardBorder={borderColor}
            accentColor={palette.purple}
            t={t}
          />
        </View>
      </View>

      {/* Settings */}
      <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          {t('profile.settingsTitle')}
        </Text>

        <Text style={[styles.formLabel, { color: textColor, marginTop: 8 }]}>
          {t('profile.theme')}
        </Text>
        <View style={styles.optionRow}>
          {[
            { id: 'dark', label: t('profile.themeDark') },
            { id: 'light', label: t('profile.themeLight') },
          ].map((option) => {
            const active = (option.id === 'dark') === isDark;
            return (
              <TouchableOpacity
                key={`theme-${option.id}`}
                onPress={() => {
                  haptic.selection();
                  setIsDark(option.id === 'dark');
                }}
                style={[
                  styles.optionChip,
                  active && styles.optionChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    active && styles.optionChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.formLabel, { color: textColor }]}>
          {t('profile.language')}
        </Text>
        <View style={styles.optionRow}>
          {[
            { id: 'ru', label: 'Русский' },
            { id: 'en', label: 'English' },
          ].map((option) => {
            const active = language === option.id;
            return (
              <TouchableOpacity
                key={`lang-${option.id}`}
                onPress={() => {
                  haptic.selection();
                  setLanguage(option.id);
                }}
                style={[styles.optionChip, active && styles.optionChipActive]}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    active && styles.optionChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={toggleNotifications}
        >
          <Text style={styles.primaryButtonText}>
            {notificationsEnabled
              ? `🔕 ${t('notifications.disable')}`
              : `🔔 ${t('notifications.enable')}`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, { marginTop: 8 }]}
          onPress={exportData}
        >
          <Text style={styles.secondaryButtonText}>
            📦 {t('profile.exportCsv')}
          </Text>
        </TouchableOpacity>
      </View>

      {userEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase() && (
        <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
          <Text style={[styles.cardTitle, { color: textColor }]}>
            🛠 Админ: пополнение баланса
          </Text>

          <Text style={[styles.formLabel, { color: textColor, marginTop: 8 }]}>
            Email или имя пользователя
          </Text>
          <TextInput
            value={adminTopUpTarget}
            onChangeText={setAdminTopUpTarget}
            placeholder="user@example.com"
            placeholderTextColor={secondaryText}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={[styles.input, { color: textColor, borderColor }]}
            editable={!adminTopUpBusy}
          />

          <Text style={[styles.formLabel, { color: textColor }]}>
            Сумма (₽)
          </Text>
          <TextInput
            value={adminTopUpAmount}
            onChangeText={(v) => setAdminTopUpAmount(v.replace(/[^0-9]/g, ''))}
            placeholder="500"
            placeholderTextColor={secondaryText}
            keyboardType="number-pad"
            style={[styles.input, { color: textColor, borderColor }]}
            editable={!adminTopUpBusy}
          />

          <View style={styles.optionRow}>
            {[100, 500, 1000, 5000].map((preset) => {
              const active = adminTopUpAmount === String(preset);
              return (
                <TouchableOpacity
                  key={`adm-preset-${preset}`}
                  onPress={() => {
                    haptic.selection();
                    setAdminTopUpAmount(String(preset));
                  }}
                  disabled={adminTopUpBusy}
                  style={[
                    styles.optionChip,
                    active && styles.optionChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      active && styles.optionChipTextActive,
                    ]}
                  >
                    {preset}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, adminTopUpBusy && { opacity: 0.6 }]}
            onPress={handleAdminTopUp}
            disabled={adminTopUpBusy}
          >
            {adminTopUpBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>💰 Пополнить</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={handleLogout}
      >
        <Text style={styles.logoutButtonText}>{t('profile.logout')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSocialScreen = () => {
    const tabs = [
      { id: 'leaderboard', label: t('social.tabLeaderboard') },
      { id: 'feed', label: t('social.tabFeed') },
      { id: 'friends', label: t('social.tabFriends') },
      { id: 'rooms', label: t('social.tabRooms') },
    ];
    return (
      <View style={styles.section}>
        {renderBackButton()}
        {renderBrandHeader(t('social.brandSubtitle'), false)}
        <Text style={[styles.sectionTitle, { color: textColor }]}>
          {t('social.title')}
        </Text>

        <View style={styles.optionRow}>
          {tabs.map((tab) => {
            const active = socialTab === tab.id;
            return (
              <TouchableOpacity
                key={`stab-${tab.id}`}
                onPress={() => {
                  haptic.selection();
                  setSocialTab(tab.id);
                }}
                style={[styles.optionChip, active && styles.optionChipActive]}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    active && styles.optionChipTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {socialTab === 'leaderboard' && (
          <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
            <Text style={[styles.cardTitle, { color: textColor }]}>
              🏆 {t('social.tabLeaderboard')}
            </Text>
            <View style={{ marginTop: 8 }}>
              <LeaderboardList
                rows={leaderboard}
                currentUserId={currentUserId}
                textColor={textColor}
                mutedColor={secondaryText}
                borderColor={borderColor}
                highlight={palette.purple}
                t={t}
              />
            </View>
            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 8 }]}
              onPress={loadLeaderboard}
            >
              <Text style={styles.secondaryButtonText}>{t('social.refresh')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {socialTab === 'feed' && (
          <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
            <Text style={[styles.cardTitle, { color: textColor }]}>
              ⚡ {t('social.tabFeed')}
            </Text>
            <View style={{ marginTop: 8 }}>
              <ActivityFeed
                events={feedEvents}
                reactions={feedReactions}
                currentUserId={currentUserId}
                onReact={reactToActivity}
                textColor={textColor}
                mutedColor={secondaryText}
                borderColor={borderColor}
                highlight={palette.purple}
                locale={localeTag}
                t={t}
              />
            </View>
          </View>
        )}

        {socialTab === 'friends' && (
          <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
            <Text style={[styles.cardTitle, { color: textColor }]}>
              🤝 {t('social.tabFriends')}
            </Text>
            <TextInput
              placeholder={t('social.addFriend')}
              placeholderTextColor={secondaryText}
              value={friendInput}
              onChangeText={setFriendInput}
              autoCapitalize="none"
              style={[styles.input, inputThemeStyle, { marginTop: 8 }]}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={addFriendByName}>
              <Text style={styles.primaryButtonText}>{t('social.addFriendButton')}</Text>
            </TouchableOpacity>

            <View style={{ marginTop: 12 }}>
              <FriendsList
                friendships={friendships}
                currentUserId={currentUserId}
                onAccept={(row) => respondFriend(row, 'accepted')}
                onDecline={(row) => respondFriend(row, 'declined')}
                onRemove={removeFriend}
                textColor={textColor}
                mutedColor={secondaryText}
                borderColor={borderColor}
                highlight={palette.purple}
                t={t}
              />
            </View>
          </View>
        )}

        {socialTab === 'rooms' && (
          <>
            <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
              <Text style={[styles.cardTitle, { color: textColor }]}>
                🔐 {t('social.createRoom')}
              </Text>
              <TextInput
                placeholder={t('social.roomNamePlaceholder')}
                placeholderTextColor={secondaryText}
                value={roomTitleInput}
                onChangeText={setRoomTitleInput}
                style={[styles.input, inputThemeStyle, { marginTop: 8 }]}
              />
              <TouchableOpacity style={styles.primaryButton} onPress={createPrivateRoom}>
                <Text style={styles.primaryButtonText}>{t('social.createRoomGo')}</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
              <Text style={[styles.cardTitle, { color: textColor }]}>
                🎟 {t('social.joinByCode')}
              </Text>
              <TextInput
                placeholder="ABC123"
                placeholderTextColor={secondaryText}
                value={roomCodeInput}
                onChangeText={(value) => setRoomCodeInput(value.toUpperCase())}
                autoCapitalize="characters"
                style={[styles.input, inputThemeStyle, { marginTop: 8 }]}
              />
              <TouchableOpacity style={styles.primaryButton} onPress={joinPrivateRoom}>
                <Text style={styles.primaryButtonText}>{t('social.joinRoomGo')}</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
              <Text style={[styles.cardTitle, { color: textColor }]}>
                {t('social.myRooms')}
              </Text>
              {privateRooms.length === 0 ? (
                <Text style={{ color: secondaryText, fontSize: 13, marginTop: 8 }}>
                  {t('social.noRoomsYet')}
                </Text>
              ) : (
                privateRooms.map((room) => (
                  <View
                    key={`room-${room.id}`}
                    style={{
                      paddingVertical: 10,
                      borderTopWidth: 1,
                      borderTopColor: borderColor,
                    }}
                  >
                    <Text style={{ color: textColor, fontWeight: '700' }}>
                      {room.title}
                    </Text>
                    <Text style={{ color: secondaryText, fontSize: 12 }}>
                      {t('social.roomMeta', {
                        code: room.invite_code,
                        start: room.starts_at,
                        end: room.ends_at,
                      })}
                    </Text>
                    <TouchableOpacity
                      onPress={() => sharePrivateRoom(room)}
                      style={[styles.smallPurpleButton, { marginTop: 6, alignSelf: 'flex-start' }]}
                    >
                      <Text style={styles.smallPurpleButtonText}>
                        {t('social.shareCode')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </View>
    );
  };

  const renderTopUpScreen = () => {
    const cfg = defaultsForRegion(topUpRegion);
    const regionOptions = [
      { id: 'ru', label: '🇷🇺 RU / СНГ' },
      { id: 'eu', label: '🇪🇺 Europe' },
      { id: 'global', label: '🌍 Other' },
    ];
    const isPaid = topUpStatus === 'paid';
    const isPending = topUpStatus === 'pending' || topUpStatus === 'creating';
    const expired = ['expired', 'failed', 'cancelled'].includes(topUpStatus);

    return (
      <View style={styles.section}>
        {renderBackButton()}
        {renderBrandHeader()}
        <Text style={[styles.sectionTitle, { color: textColor }]}>{t('topup.title')}</Text>
        <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
          {t('topup.subtitle')}
        </Text>

        <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
          <Text style={[styles.cardTitle, { color: textColor }]}>
            {t('topup.regionTitle')}
          </Text>
          <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
            {t('topup.regionPick', {
              label: cfg.label,
              provider: cfg.provider === 'cryptocloud' ? 'CryptoCloud' : 'Cryptomus',
            })}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {regionOptions.map((opt) => {
              const active = topUpRegion === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  onPress={() => handleTopUpRegionChange(opt.id)}
                  style={[
                    styles.smallPurpleButton,
                    active && { borderColor: '#A855F7', borderWidth: 1.5 },
                  ]}
                >
                  <Text style={styles.smallPurpleButtonText}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
          <Text style={[styles.cardTitle, { color: textColor }]}>
            {t('topup.amountTitle', { currency: cfg.currency })}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {cfg.quickAmounts.map((amt) => {
              const active = String(topUpAmount) === String(amt);
              return (
                <TouchableOpacity
                  key={`amt-${amt}`}
                  onPress={() => setTopUpAmount(String(amt))}
                  style={[
                    styles.smallPurpleButton,
                    active && { borderColor: '#A855F7', borderWidth: 1.5 },
                  ]}
                  disabled={isPending}
                >
                  <Text style={styles.smallPurpleButtonText}>
                    {formatTopUpAmount(amt, cfg.currency)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={[
              styles.input,
              { color: textColor, borderColor, marginTop: 10 },
            ]}
            placeholder={t('topup.customAmount', { currency: cfg.currency })}
            placeholderTextColor={secondaryText}
            keyboardType="decimal-pad"
            value={topUpAmount}
            onChangeText={setTopUpAmount}
            editable={!isPending}
          />

          {!topUpInvoice ? (
            <TouchableOpacity
              onPress={() => startTopUpInvoice(topUpAmount)}
              disabled={topUpLoading || !topUpAmount}
              style={[
                styles.topUpButton,
                {
                  marginTop: 12,
                  opacity: topUpLoading || !topUpAmount ? 0.5 : 1,
                },
              ]}
            >
              {topUpLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.topUpButtonText}>{t('topup.goPay')}</Text>
              )}
            </TouchableOpacity>
          ) : null}
        </View>

        {topUpInvoice ? (
          <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
            <Text style={[styles.cardTitle, { color: textColor }]}>
              {isPaid
                ? t('topup.statusPaid')
                : isPending
                ? t('topup.statusPending')
                : expired
                ? t('topup.statusFailed')
                : t('topup.statusInvoice')}
            </Text>
            <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
              {t('topup.amountCreditLine', {
                from: formatTopUpAmount(topUpInvoice.source_amount, topUpInvoice.source_currency),
                rub: topUpInvoice.balance_amount_rub,
              })}
            </Text>
            <Text style={[styles.cardSubtitle, { color: secondaryText, marginTop: 4 }]}>
              {t('topup.gatewayLine', {
                provider: topUpInvoice.provider,
                cur: topUpInvoice.source_currency,
                rate: Number(topUpInvoice.fx_rate).toFixed(2),
              })}
            </Text>

            {!isPaid ? (
              <>
                <TouchableOpacity
                  onPress={() => Linking.openURL(topUpInvoice.pay_url).catch(() => {})}
                  style={[styles.topUpButton, { marginTop: 12 }]}
                >
                  <Text style={styles.topUpButtonText}>{t('topup.openPay')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={refreshTopUpStatus}
                  style={[styles.smallPurpleButton, { marginTop: 8, alignSelf: 'flex-start' }]}
                >
                  <Text style={styles.smallPurpleButtonText}>{t('topup.checkStatus')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={cancelTopUp}
                  style={[
                    styles.smallPurpleButton,
                    { marginTop: 8, alignSelf: 'flex-start', borderColor: 'rgba(239,68,68,0.6)' },
                  ]}
                >
                  <Text style={[styles.smallPurpleButtonText, { color: '#FCA5A5' }]}>
                    {t('topup.cancelRestart')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  cancelTopUp();
                  setScreen('profile');
                }}
                style={[styles.topUpButton, { marginTop: 12 }]}
              >
                <Text style={styles.topUpButtonText}>{t('common.done')}</Text>
              </TouchableOpacity>
            )}

            <Text style={[styles.cardSubtitle, { color: secondaryText, marginTop: 12, fontSize: 11 }]}>
              {t('topup.footnote')}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  const renderHelpScreen = () => (
    <View style={styles.section}>
      {renderBackButton()}
      {renderBrandHeader()}
      <Text style={[styles.sectionTitle, { color: textColor }]}>
        {t('help.title')}
      </Text>
      <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
        {t('help.subtitle')}
      </Text>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          {t('help.navTitle')}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('help.navBody')}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          {t('help.moneyTitle')}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {t('help.moneyBody')}
        </Text>
      </View>
    </View>
  );

  const toastTranslate = toastAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-12, 0],
  });
  const activeToast = toast ? toastStyles[toast.type] : null;
  return (
    <View
      style={[
        styles.safe,
        { backgroundColor: isDark ? '#01020A' : '#01020A' },
      ]}
    >
      <SafeAreaView style={[styles.safe, { backgroundColor: 'transparent' }]}>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
          translucent
        />
        <View style={[styles.container, { backgroundColor: 'transparent' }]}>
          <ParticleBackground isDark={isDark} />
          {toast && activeToast ? (
            <Animated.View
              style={[
                styles.toast,
                {
                  backgroundColor: activeToast.background,
                  borderColor: activeToast.border,
                  opacity: toastAnim,
                  transform: [{ translateY: toastTranslate }],
                },
              ]}
            >
              <Text style={[styles.toastText, { color: activeToast.text }]}>
                {toast.message}
              </Text>
            </Animated.View>
          ) : null}

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerSpacer} />
            <View style={styles.headerRight}>
            {isAuthenticated ? (
              <TouchableOpacity
                style={styles.balanceBadge}
                onPress={() => {
                  haptic.selection();
                  openTopUpScreen();
                }}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={t('profile.topUpOpen')}
              >
                <Text style={styles.balanceBadgeText}>
                  {t('header.balance', { amount: balance })}
                </Text>
              </TouchableOpacity>
            ) : null}
              <TouchableOpacity
                style={[
                  styles.themeButton,
                  { borderColor: palette.borderStrong },
                ]}
                onPress={() => {
                  haptic.selection();
                  setIsDark((prev) => !prev);
                }}
              >
                <Text
                  style={[
                    styles.themeButtonText,
                    { color: textColor },
                  ]}
                >
                  {isDark ? t('profile.themeLight') : t('profile.themeDark')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {isAuthenticated && screen === 'weblanding' ? (
            <HabitForgeWebScreen
              onClose={() => {
                haptic.selection();
                setScreen('home');
              }}
              t={t}
              borderColor={borderColor}
              textColor={textColor}
              secondaryText={secondaryText}
            />
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {!isAuthenticated && renderAuthScreen()}
              {isAuthenticated && renderScreenTabs()}
              {isAuthenticated && screen === 'home' && renderHome()}
              {isAuthenticated && screen === 'habits' && renderHabitsScreen()}
              {isAuthenticated && screen === 'challenge' && renderChallengeScreen()}
              {isAuthenticated && screen === 'social' && renderSocialScreen()}
              {isAuthenticated && screen === 'profile' && renderProfileScreen()}
              {isAuthenticated && screen === 'topup' && renderTopUpScreen()}
              {isAuthenticated && screen === 'help' && renderHelpScreen()}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
