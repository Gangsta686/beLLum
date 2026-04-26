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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import {
  isSupabaseConfigured,
  supabase,
} from './lib/supabase';
import styles from './styles';
const {
  formatDateKey,
  getJoinChallengeErrorMessage,
  getNextBetStats,
  mapParticipantRow,
  normalizeJoinChallengeResponse,
} = require('./lib/challengeUtils');

const PURPLE = '#7C3AED';
const DARK_BG = '#02030A';
const LIGHT_BG = '#02030A';
const LIGHT_TEXT = '#F8FAFC';
const DARK_TEXT = '#F8FAFC';

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
  const [isDark, setIsDark] = useState(true);
  const LOGIN_CHANGE_COOLDOWN_DAYS = 14;

  // Simple navigation between screens
  const [screen, setScreen] = useState('home'); // 'home' | 'habits' | 'challenge' | 'profile' | 'help'

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
  const [toast, setToast] = useState(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef(null);

  // Habit state
  const [habitTitle, setHabitTitle] = useState('');
  const [habitDescription, setHabitDescription] = useState('');
  const habitCategoryOptions = ['Здоровье', 'Спорт', 'Фокус', 'Сон'];
  const habitFrequencyOptions = ['Ежедневно', '3 раза в неделю', 'По будням'];
  const habitPriorityOptions = ['Низкий', 'Средний', 'Высокий'];
  const [habitCategory, setHabitCategory] = useState('Здоровье');
  const [habitFrequency, setHabitFrequency] = useState('Ежедневно');
  const [habitPriority, setHabitPriority] = useState('Средний');
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
  }, [isAuthenticated, loginName, userEmail, balance, avatarUri]);

  const showToast = (type, message) => {
    setToast({ type, message });
  };

  const formatRegisteredAt = (value) => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const withTimeout = async (promise, timeoutMs = 15000) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('Превышено время ожидания ответа сервера.')),
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

  const getProfileSyncHint = (error) => {
    const message = (error?.message || '').toLowerCase();
    if (message.includes('relation') && message.includes('profiles')) {
      return 'Таблица profiles не найдена. Запусти supabase/profiles.sql в SQL Editor.';
    }
    if (
      message.includes('row-level security') ||
      message.includes('permission denied') ||
      error?.code === '42501'
    ) {
      return 'Нет прав на profiles. Запусти supabase/profiles.sql заново, чтобы применить RLS policy.';
    }
    return `Ошибка профиля Supabase: ${error?.message || 'неизвестная ошибка'}`;
  };

  const getAuthErrorMessage = (error, fallback) => {
    const message = error?.message || '';
    const normalized = message.toLowerCase();
    if (normalized.includes('already registered')) {
      return 'Аккаунт с этой почтой уже есть. Переключись на вход.';
    }
    if (normalized.includes('password')) {
      return 'Пароль слишком короткий. Используй минимум 6 символов.';
    }
    if (normalized.includes('email not confirmed')) {
      return 'Сначала подтверди почту, затем войди.';
    }
    if (normalized.includes('email rate limit exceeded')) {
      return 'Supabase временно ограничил отправку писем. Подожди несколько минут или отключи подтверждение email в Supabase Auth.';
    }
    if (normalized.includes('invalid login credentials')) {
      return 'Неверная почта или пароль.';
    }
    if (message.includes('Превышено время ожидания')) {
      return 'Сервер долго отвечает. Проверь интернет и попробуй ещё раз.';
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
          showToast('warning', 'Не удалось прочитать сессию Supabase.');
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
        .select('display_name, balance, created_at')
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
        },
        { onConflict: 'id' }
      );
      if (error) {
        console.error('Failed to sync profile:', error);
      }
    };

    syncProfile();
  }, [isAuthenticated, currentUserId, isProfileReady, loginName, balance]);

  const exerciseOptions = [
    'Отжимания',
    'Планка',
    'Приседания',
    'Бёрпи',
    'Скакалка',
    'Подтягивания',
  ];
  const getWeekStartDate = (date = new Date()) => {
    const current = new Date(date);
    const day = current.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    current.setHours(0, 0, 0, 0);
    current.setDate(current.getDate() + diff);
    return current;
  };
  const pickWeeklyExercises = (options) => {
    const count = Math.floor(Math.random() * 3) + 1;
    const shuffled = [...options].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  };
  const [challenges, setChallenges] = useState([]);
  const [challengeFilter, setChallengeFilter] = useState('all');
  const [challengePage, setChallengePage] = useState(1);
  const [weeklyStartAt, setWeeklyStartAt] = useState(() => getWeekStartDate());
  const [weeklyExercises, setWeeklyExercises] = useState(() =>
    pickWeeklyExercises(exerciseOptions)
  );
  const [weeklyOutcome, setWeeklyOutcome] = useState(null); // 'success' | 'fail'

  const backgroundColor = isDark ? DARK_BG : LIGHT_BG;
  const textColor = isDark ? DARK_TEXT : LIGHT_TEXT;
  const cardColor = 'transparent';
  const secondaryText = isDark ? '#C7D2FE' : '#C7D2FE';

  const msInDay = 24 * 60 * 60 * 1000;
  const prizePool = BASE_PRIZE + participants.length * ENTRY_FEE;
  const weeklyEndAt = new Date(
    weeklyStartAt.getTime() + (WEEK_LENGTH_DAYS - 1) * msInDay
  );
  const weeklyStartKey = formatDateKey(weeklyStartAt);
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
      setGroupError('Не удалось загрузить участников.');
      return null;
    }

    const nextParticipants = (data || []).map(mapWeeklyParticipantRow);
    setParticipants(nextParticipants);
    const myParticipant = nextParticipants.find(
      (participant) => participant.userId === currentUserId
    );
    setMyParticipantId(myParticipant?.id || null);
    return nextParticipants;
  }, [currentUserId, mapWeeklyParticipantRow, weeklyStartKey]);

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
      const [, nextParticipants] = await Promise.all([
        loadProfileBalance(),
        loadWeeklyParticipants(),
      ]);
      return nextParticipants;
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
        showToast('success', 'Участие найдено и восстановлено.');
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

  const addHabit = () => {
    if (!habitTitle.trim()) return;
    const newHabit = {
      id: Date.now().toString(),
      title: habitTitle.trim(),
      description: habitDescription.trim(),
      category: habitCategory,
      frequency: habitFrequency,
      priority: habitPriority,
      progress: 0,
    };
    setHabits((prev) => [newHabit, ...prev]);
    setHabitTitle('');
    setHabitDescription('');
    setHabitCategory('Здоровье');
    setHabitFrequency('Ежедневно');
    setHabitPriority('Средний');
  };

  const incrementHabit = (id) => {
    setHabits((prev) =>
      prev.map((h) =>
        h.id === id ? { ...h, progress: h.progress + 1 } : h
      )
    );
    // Каждое успешное выполнение привычки считаем выполненным днём
    setDoneDays((prev) => prev + 1);
  };

  const joinChallenge = async () => {
    setGroupError('');
    if (!isSupabaseConfigured || !supabase || !currentUserId) {
      const message = 'Общий челлендж доступен после регистрации или входа.';
      setGroupError(message);
      showToast('warning', message);
      return;
    }

    if (isJoined) {
      setGroupError('Ты уже вступил в челлендж недели.');
      showToast('warning', 'Ты уже в списке участников.');
      return;
    }

    if (participants.length >= MAX_PARTICIPANTS) {
      setGroupError('Челлендж заполнен.');
      showToast('warning', 'Челлендж заполнен.');
      return;
    }

    const trimmedName = nickname.trim() || loginName.trim();
    if (!trimmedName) {
      setGroupError('Укажи ник для участия.');
      showToast('error', 'Укажи ник для участия.');
      return;
    }

    const exists = participants.some(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (exists) {
      setGroupError('Такой ник уже есть в списке.');
      showToast('warning', 'Такой ник уже есть.');
      return;
    }

    if (balance < ENTRY_FEE) {
      setGroupError('Недостаточно баланса для взноса 500 ₽.');
      showToast('error', 'Недостаточно баланса.');
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
        const message = getJoinChallengeErrorMessage(error);
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
          const message =
            'Сервер не подтвердил участие. Баланс обновлён повторной проверкой.';
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
      showToast('success', 'Участие подтверждено.');
      loadWeeklyParticipants();
    } catch (error) {
      console.error('Join challenge failed:', error);
      const message = getJoinChallengeErrorMessage(error);
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
    showToast('warning', 'Статусы участников меняются после завершения недели.');
  };

  const renderHabit = ({ item }) => (
    <View
      style={[
        styles.card,
        {
          backgroundColor: cardColor,
          borderColor: 'transparent',
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          {item.title}
        </Text>
        <TouchableOpacity
          style={styles.habitInlineButton}
          onPress={() => incrementHabit(item.id)}
        >
          <Text style={styles.habitInlineButtonText}>+1</Text>
        </TouchableOpacity>
      </View>
      {item.description ? (
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          {item.description}
        </Text>
      ) : null}
      <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
        {item.category} · {item.frequency} · Приоритет: {item.priority}
      </Text>
      <Text style={[styles.progressText, { color: secondaryText }]}>
        Завершено: {item.progress}
      </Text>
    </View>
  );

  const cycleAvatar = () => {
    setAvatarIndex((prev) => (prev + 1) % avatarOptions.length);
  };

  const pickAvatarImage = async () => {
    try {
      setAvatarError('');
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setAvatarError('Нужно разрешение на доступ к фото.');
        showToast('warning', 'Доступ к фото запрещён.');
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
        setAvatarError('Не удалось выбрать фото.');
        showToast('error', 'Ошибка выбора фото.');
        return;
      }

      setAvatarUri(selected.uri);
      showToast('success', 'Аватар обновлён.');
    } catch (error) {
      console.error('Failed to pick avatar image:', error);
      setAvatarError('Ошибка при выборе фото.');
      showToast('error', 'Ошибка при выборе фото.');
    }
  };

  const renderBackButton = () =>
    null;

  const renderBrandHeader = (
    subtitle = 'Фитнес‑трекер привычек с социальной ответственностью',
    showIcon = true
  ) => (
    <View style={styles.brandHeader}>
      <View style={styles.brandRow}>
        {showIcon ? (
          <Image source={require('./assets/icon.png')} style={styles.brandIcon} />
        ) : null}
        <Text style={styles.brandTitle}>beLLum</Text>
      </View>
      <Text style={styles.brandSubtitle}>{subtitle}</Text>
    </View>
  );

  const renderScreenTabs = () => {
    const tabs = [
      { id: 'home', label: 'Главная', icon: 'home-outline' },
      { id: 'habits', label: 'Привычки', icon: 'barbell-outline' },
      { id: 'challenge', label: 'Общий челлендж', icon: 'trophy-outline' },
      { id: 'profile', label: 'Профиль', icon: 'person-outline' },
      { id: 'help', label: 'Справка', icon: 'help-circle-outline' },
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
      setLoginError('Укажи логин.');
      showToast('error', 'Логин не задан.');
      return;
    }
    if (!canChangeLogin) {
      setLoginError(`Можно менять через ${loginDaysLeft} дн.`);
      showToast('warning', 'Смена логина пока недоступна.');
      return;
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.updateUser({
        data: { display_name: nextLogin },
      });
      if (error) {
        setLoginError(error.message || 'Не удалось обновить логин.');
        showToast('error', 'Ошибка обновления логина.');
        return;
      }
    }

    setLoginName(nextLogin);
    setLastLoginChange(Date.now());
    setLoginError('');
    showToast('success', 'Логин обновлён.');
  };

  const handleAuthSubmit = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const isCloudAuthAvailable = isSupabaseConfigured && Boolean(supabase);
      if (!isCloudAuthAvailable) {
        setAuthError(
          'Supabase не настроен или недоступен. Проверь .env, интернет и перезапусти Expo.'
        );
        return;
      }

      if (authMode === 'register') {
        const trimmedName = authName.trim();
        const trimmedEmail = authEmail.trim();
        if (trimmedName.length < 5) {
          setAuthError('Логин должен быть минимум 5 символов.');
          return;
        }
        const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
        if (!emailValid) {
          setAuthError('Укажи корректную почту.');
          return;
        }
        if (!authPassword.trim()) {
          setAuthError('Заполни пароль.');
          return;
        }
        const trimmedPassword = authPassword.trim();

        const { data, error } = await withTimeout(
          supabase.auth.signUp({
            email: trimmedEmail,
            password: trimmedPassword,
            options: {
              data: {
                display_name: trimmedName,
              },
            },
          }),
          15000
        );

        if (error) {
          setAuthError(getAuthErrorMessage(error, 'Ошибка регистрации.'));
          return;
        }

        if (!data?.user) {
          setAuthError('Supabase не вернул пользователя после регистрации.');
          return;
        }

        setLoginName(trimmedName);
        setLoginDraft(trimmedName);
        setUserEmail(trimmedEmail);
        setLoginInput(trimmedEmail);
        setAuthPassword('');
        if (data.session) {
          setCurrentUserId(data.user.id);
          setRegisteredAt(data.user.created_at || '');
          setIsProfileReady(false);
          setIsAuthenticated(true);
          setScreen('home');
          showToast('success', 'Регистрация выполнена.');
        } else {
          if (data.user.identities && data.user.identities.length === 0) {
            setAuthError('Аккаунт с этой почтой уже есть. Войди с паролем.');
          } else {
            setAuthError('Аккаунт создан. Если Supabase просит подтверждение, проверь почту.');
          }
          setAuthMode('login');
          showToast('warning', 'Проверь почту или войди с этим email.');
        }
        return;
      }

      const trimmedEmail = loginInput.trim().toLowerCase();
      if (!trimmedEmail) {
        setAuthError('Укажи email.');
        return;
      }
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
      if (!emailValid) {
        setAuthError('Введи корректный email.');
        return;
      }
      if (!loginPassword.trim()) {
        setAuthError('Введи пароль.');
        return;
      }

      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: loginPassword.trim(),
        }),
        15000
      );

      if (error) {
        setAuthError(getAuthErrorMessage(error, 'Неверный email или пароль.'));
        return;
      }

      const nextLogin =
        data.user?.user_metadata?.display_name ||
        data.user?.email?.split('@')[0] ||
        '';
      setLoginName(nextLogin);
      setLoginDraft(nextLogin);
      setUserEmail(data.user?.email || trimmedEmail);
      setCurrentUserId(data.user?.id || null);
      setRegisteredAt(data.user?.created_at || '');
      setIsProfileReady(false);
      setIsAuthenticated(true);
      setScreen('home');
      setLoginPassword('');
      showToast('success', 'Вход выполнен.');
    } catch (error) {
      console.error('Auth submit failed:', error);
      setAuthError(
        getAuthErrorMessage(
          error,
          'Сетевая ошибка. Проверь интернет и попробуй снова.'
        )
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGuestLogin = () => {
    setAuthError('');
    setLoginName('Гость');
    setLoginDraft('Гость');
    setUserEmail('');
    setIsAuthenticated(true);
    setScreen('home');
    showToast('warning', 'Гостевой вход без подключения к Supabase.');
  };

  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setAuthError(error.message || 'Ошибка выхода.');
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
      showToast('warning', 'Удаление доступно только в первые 12 часов.');
      return;
    }
    setChallenges((prev) =>
      prev.filter((item) => item.id !== challenge.id)
    );
    showToast('success', 'Челлендж удалён.');
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
      showToast('success', 'Челлендж отмечен как выполненный.');
    }
    if (nextStatus === 'fail') {
      showToast('warning', 'Челлендж отмечен как срыв.');
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
      setGroupError('Сначала вступи в челлендж.');
      showToast('warning', 'Сначала вступи в челлендж.');
      return;
    }
    if (!canFinalizeWeek) {
      setGroupError('Неделя ещё не завершена.');
      showToast('warning', 'Неделя ещё не завершена.');
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
        setGroupError('Не удалось зафиксировать итог недели.');
        showToast('error', 'Не удалось зафиксировать итог недели.');
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
    if (outcome === 'success') {
      setBalance((prev) => prev + ENTRY_FEE);
      showToast('success', 'Неделя завершена: успех.');
    } else {
      showToast('error', 'Неделя завершена: срыв.');
    }
    loadWeeklyParticipants();
  };

  const resetWeeklyChallenge = () => {
    const newStart = getWeekStartDate();
    setWeeklyStartAt(newStart);
    setWeeklyExercises(pickWeeklyExercises(exerciseOptions));
    setWeeklyOutcome(null);
    setParticipants([]);
    setMyParticipantId(null);
    setNickname('');
    setGroupError('');
    showToast('success', 'Новая неделя запущена.');
  };

  const topUpBalance = (amount) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBalance((prev) => prev + amount);
    showToast('success', `Баланс пополнен на ${amount} ₽`);
  };

  const formatShortDate = (date) =>
    date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

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
        Создай аккаунт и начни формировать новые привычки.
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
              Регистрация
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
              Вход
            </Text>
          </TouchableOpacity>
        </View>

        {authMode === 'register' ? (
          <>
            <TextInput
              placeholder="Логин (минимум 5 символов)"
              placeholderTextColor={secondaryText}
              value={authName}
              onChangeText={setAuthName}
              style={[styles.input, inputThemeStyle]}
            />

            <TextInput
              placeholder="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor={secondaryText}
              value={authEmail}
              onChangeText={setAuthEmail}
              style={[styles.input, inputThemeStyle]}
            />

            <TextInput
              placeholder="Пароль"
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
              placeholder="Email"
              placeholderTextColor={secondaryText}
              value={loginInput}
              onChangeText={setLoginInput}
              style={[styles.input, inputThemeStyle]}
              autoCapitalize="none"
            />
            <TextInput
              placeholder="Пароль"
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
              ? 'Подождите...'
              : authMode === 'register'
              ? 'Зарегистрироваться'
              : 'Войти'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleGuestLogin}
          disabled={authLoading}
        >
          <Text style={styles.secondaryButtonText}>Войти как гость</Text>
        </TouchableOpacity>

        <Text style={[styles.authHintText, { color: secondaryText }]}>
          {isSupabaseConfigured
            ? 'Supabase подключен: можно переводить регистрацию и вход на удаленную БД.'
            : 'Supabase еще не настроен: добавь EXPO_PUBLIC_SUPABASE_URL и EXPO_PUBLIC_SUPABASE_ANON_KEY в .env.'}
        </Text>
      </View>
    </View>
  );

  const renderHome = () => (
    <View style={styles.section}>
      {renderBrandHeader(undefined, false)}

      <AnimatedCard style={styles.heroCard}>
        <Text style={styles.heroTitle}>Начните фитнес‑челлендж!</Text>
        <Text style={styles.heroSubtitle}>
          Выберите упражнение, задайте план — и придерживайтесь его.
        </Text>

        <GradientButton
          label="Привычки"
          iconName="barbell-outline"
          onPress={() => {
            setScreen('habits');
          }}
          style={styles.heroButton}
        />
        <GradientButton
          label="Общий челлендж"
          iconName="trophy-outline"
          onPress={() => {
            setScreen('challenge');
          }}
          style={styles.heroButton}
        />
        <GradientButton
          label="Личный кабинет"
          iconName="person-circle-outline"
          onPress={() => setScreen('profile')}
          style={styles.heroButton}
        />
        <GradientButton
          label="Справка"
          iconName="help-circle-outline"
          onPress={() => setScreen('help')}
          style={styles.heroButton}
        />
      </AnimatedCard>

      <Text style={styles.footerTiny}>beLLum v3.0 • Сделано с ❤️</Text>
    </View>
  );

  const renderHabitsScreen = () => (
    <View style={styles.section}>
      {renderBackButton()}
      <Text style={[styles.sectionTitle, { color: textColor }]}>
        Мои привычки
      </Text>
      <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
        Ставь цель, отслеживай прогресс и превращай привычки в игру.
      </Text>

      <View style={[styles.inputCard, styles.habitsTransparentCard]}>
        <TextInput
          placeholder="Цель (например: бег 3 раза в неделю)"
          placeholderTextColor={secondaryText}
          value={habitTitle}
          onChangeText={setHabitTitle}
          style={[styles.input, inputThemeStyle]}
        />
        <TextInput
          placeholder="Краткое описание / правило"
          placeholderTextColor={secondaryText}
          value={habitDescription}
          onChangeText={setHabitDescription}
          style={[styles.input, inputThemeStyle]}
        />
        <Text style={[styles.formLabel, { color: textColor }]}>КАТЕГОРИЯ</Text>
        <View style={styles.optionRow}>
          {habitCategoryOptions.map((option) => {
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
                  {option}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.formLabel, { color: textColor }]}>ЧАСТОТА</Text>
        <View style={styles.optionRow}>
          {habitFrequencyOptions.map((option) => {
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
                  {option}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.formLabel, { color: textColor }]}>ПРИОРИТЕТ</Text>
        <View style={styles.optionRow}>
          {habitPriorityOptions.map((option) => {
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
                  {option}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <GradientButton
          label="Добавить привычку"
          iconName="add-circle-outline"
          onPress={addHabit}
          style={styles.habitsCreateButton}
          buttonStyle={styles.habitTransparentButton}
        />
      </View>

      {habits.length === 0 ? (
        <Text style={[styles.emptyText, { color: secondaryText }]}>
          Пока нет привычек. Начни с первой цели выше.
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
            <Text style={styles.weekBannerText}>👥  ОБЩИЙ ЧЕЛЛЕНДЖ НЕДЕЛИ</Text>
          </TouchableOpacity>

          <View style={[styles.card, { backgroundColor: cardColor }]}>
            <Text style={[styles.listTitle, { color: textColor }]}>
              ☰ Все челленджи
            </Text>
            <View style={styles.sectionUnderline} />
            <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
              Максимум 5 активных челленджей одновременно
            </Text>

        <View style={styles.filterRow}>
          {[
            { id: 'all', label: 'Все челленджи' },
            { id: 'active', label: 'В процессе' },
            { id: 'success', label: 'Выполнено' },
            { id: 'fail', label: 'Срыв', fullWidth: true },
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
              Пока нет челленджей
            </Text>
            <Text style={[styles.emptyStateSubtitle, { color: secondaryText }]}>
              Создайте свой первый челлендж!
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
                      {challenge.repsTime} · {challenge.sets} подходов · {challenge.perWeek} в неделю
                    </Text>
                    <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
                      Ставка: {challenge.bet} ₽ · При срыве:{' '}
                      {challenge.failMode === 'charity' ? 'благотворительность' : 'общий котёл'}
                    </Text>
                    <View style={styles.challengeStatusRow}>
                      {['active', 'success', 'fail'].map((status) => {
                        const isActive = challenge.status === status;
                        const label =
                          status === 'active'
                            ? 'Активен'
                            : status === 'success'
                            ? 'Успех'
                            : 'Срыв';
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
                      {canDelete ? 'Удалить' : '12ч прошло'}
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
                Назад
              </Text>
            </TouchableOpacity>
            <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
              Страница {safePage} / {totalPages}
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
                Вперёд
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
          <Text style={[styles.sectionTitle, { color: textColor, marginTop: 8 }]}>
            🏆 Общий челлендж недели
          </Text>
          <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
            Запускается каждый понедельник. Длительность — {WEEK_LENGTH_DAYS} дней.
          </Text>

          <View style={[styles.card, { backgroundColor: cardColor }]}>
            <Text style={[styles.cardTitle, { color: textColor }]}>
              📅 Неделя челленджа
            </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          Старт: {formatShortDate(weeklyStartAt)} (понедельник)
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          Финиш: {formatShortDate(weeklyEndAt)}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          Упражнения недели: {weeklyExercises.join(', ')}
        </Text>
      </View>

      <View style={styles.inputCard}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          🪙 Участие и приз
        </Text>
        <TextInput
          placeholder="Ваш ник в челлендже"
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
              ? 'Подождите...'
              : isJoined
              ? 'Ты уже участвуешь'
              : participants.length >= MAX_PARTICIPANTS
              ? '🚫 Челлендж заполнен'
              : `✅ Вступить за ${ENTRY_FEE} ₽`}
          </Text>
        </TouchableOpacity>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              👥 Участники
            </Text>
            <Text style={[styles.statValue, { color: textColor }]}>
              {participants.length} / {MAX_PARTICIPANTS}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              💰 Призовой фонд
            </Text>
            <Text style={[styles.statValue, { color: textColor }]}>
              {prizePool} ₽
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              🎁 Базовый приз
            </Text>
            <Text style={[styles.statValueSmall, { color: textColor }]}>
              {BASE_PRIZE} ₽
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              🏅 Победителей
            </Text>
            <Text style={[styles.statValueSmall, { color: textColor }]}>
              {winnersCount || 0}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              💵 Взнос
            </Text>
            <Text style={[styles.statValueSmall, { color: textColor }]}>
              {ENTRY_FEE} ₽
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: secondaryText }]}>
              🧾 Выплата на победителя
            </Text>
            <Text style={[styles.statValueSmall, { color: textColor }]}>
              {payoutPerWinner} ₽
            </Text>
          </View>
        </View>

        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          При успехе ставка возвращается. При срыве уходит в призовой фонд.
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
              ? 'Итог зафиксирован'
              : canFinalizeWeek
              ? 'Завершить неделю'
              : 'Неделя ещё идёт'}
          </Text>
        </TouchableOpacity>

        {weekEnded ? (
          <TouchableOpacity
            style={styles.smallOutlineButton}
            onPress={resetWeeklyChallenge}
          >
            <Text style={[styles.smallOutlineButtonText, { color: PURPLE }]}>
              Новая неделя
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: textColor }]}>
            👥 Участники недели
          </Text>
        </View>

        {participants.length === 0 ? (
          <Text
            style={[
              styles.emptyText,
              { color: secondaryText, marginTop: 4 },
            ]}
          >
            Пока никто не вступил в челлендж.
          </Text>
        ) : (
          <View>
            {participants.map((participant, index) => (
              <View key={participant.id} style={styles.participantRow}>
                <Text
                  style={[styles.participantIndex, { color: secondaryText }]}
                >
                  #{index + 1}
                </Text>
                <Text style={[styles.participantName, { color: textColor }]}>
                  {participant.name}
                  {participant.isMe ? ' (ты)' : ''}
                </Text>
                <TouchableOpacity
                  style={styles.statusBadge}
                  onPress={() => updateParticipantStatus(participant.id)}
                  disabled={participant.isMe}
                >
                  <Text style={styles.statusBadgeText}>
                    {participant.status === 'success'
                      ? 'успех'
                      : participant.status === 'fail'
                      ? 'срыв'
                      : 'в процессе'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>
      </>
    </View>
  );

  const renderProfileScreen = () => (
    <View style={styles.section}>
      {renderBackButton()}
      {renderBrandHeader()}
      <Text style={[styles.sectionTitle, { color: textColor }]}>
        Личный кабинет
      </Text>
      <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
        Следи за своим прогрессом и настрой свой образ в beLLum.
      </Text>

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
              Твой аватар
            </Text>
            <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
              Загрузи фото или выбери эмодзи.
            </Text>
            <View style={styles.avatarButtonsRow}>
              <TouchableOpacity
                style={styles.smallOutlineButton}
                onPress={pickAvatarImage}
              >
                <Text style={[styles.smallOutlineButtonText, { color: PURPLE }]}>
                  Загрузить фото
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.smallOutlineButton}
                onPress={() => setAvatarUri('')}
              >
                <Text style={[styles.smallOutlineButtonText, { color: PURPLE }]}>
                  Сбросить фото
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.smallGhostButton}
              onPress={cycleAvatar}
            >
              <Text style={[styles.smallGhostButtonText, { color: PURPLE }]}>
                Сменить эмодзи
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
          Логин
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          Менять логин можно раз в 2 недели.
        </Text>

        <TextInput
          placeholder="Новый логин"
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
              ? 'Сохранить логин'
              : `Доступно через ${loginDaysLeft} дн.`}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          Текущий логин: {loginName || 'не задан'}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          Email аккаунта: {userEmail || 'не указан'}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          Дата регистрации: {formatRegisteredAt(registeredAt)}
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          Баланс аккаунта: {balance} ₽
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          Ваша статистика
        </Text>
        <Text style={[styles.statsHeroValue, { color: PURPLE }]}>
          {personalTotal}
        </Text>
        <Text style={[styles.statsHeroLabel, { color: secondaryText }]}>
          ВСЕГО ЧЕЛЛЕНДЖЕЙ
        </Text>

        <View style={styles.statsGrid}>
          <View style={[styles.statsTile, styles.statsTileSuccess]}>
            <Text style={[styles.statsTileValue, { color: '#10B981' }]}>
              {personalSuccess}
            </Text>
            <Text style={[styles.statsTileLabel, { color: secondaryText }]}>
              ВЫПОЛНЕНО
            </Text>
          </View>
          <View style={[styles.statsTile, styles.statsTileFail]}>
            <Text style={[styles.statsTileValue, { color: '#EF4444' }]}>
              {personalFail}
            </Text>
            <Text style={[styles.statsTileLabel, { color: secondaryText }]}>
              СРЫВОВ
            </Text>
          </View>
          <View style={[styles.statsTile, styles.statsTileActive]}>
            <Text style={[styles.statsTileValue, { color: PURPLE }]}>
              {personalActive}
            </Text>
            <Text style={[styles.statsTileLabel, { color: secondaryText }]}>
              В ПРОЦЕССЕ
            </Text>
          </View>
          <View style={[styles.statsTile, styles.statsTileTotal]}>
            <Text style={[styles.statsTileValue, { color: PURPLE }]}>
              {totalDays}
            </Text>
            <Text style={[styles.statsTileLabel, { color: secondaryText }]}>
              ВСЕГО ДНЕЙ
            </Text>
          </View>
        </View>

        <Text style={[styles.statsHeroValue, { color: PURPLE }]}>
          {successPercent}%
        </Text>
        <Text style={[styles.statsHeroLabel, { color: secondaryText }]}>
          ОБЩАЯ УСПЕШНОСТЬ
        </Text>

        <Text style={[styles.statsDetailTitle, { color: textColor }]}>
          📊 Детальная статистика:
        </Text>
        <Text style={[styles.profileStatLine, { color: textColor }]}>
          ✅ Выполнено: {doneDays} дней
        </Text>
        <Text style={[styles.profileStatLine, { color: textColor }]}>
          ❌ Пропущено: {failedDays} дней
        </Text>
        <Text style={[styles.profileStatLine, { color: textColor }]}>
          💰 Всего ставок: {totalBets} ₽
        </Text>
        <Text style={[styles.profileStatLine, { color: textColor }]}>
          🎯 Средняя ставка: {averageBet} ₽
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          💳 Баланс
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          Баланс используется только для ставок и пополняется админом.
        </Text>

        <View style={styles.balanceRow}>
          <Text style={[styles.statLabel, { color: secondaryText }]}>
            Текущий баланс
          </Text>
          <Text style={[styles.balanceValue, { color: textColor }]}>
            {balance} ₽
          </Text>
        </View>
        <View style={styles.topUpButtonsRow}>
          {[500, 1000, 2000].map((amount) => (
            <TouchableOpacity
              key={`topup-${amount}`}
              style={styles.topUpButton}
              onPress={() => topUpBalance(amount)}
            >
              <Text style={styles.topUpButtonText}>+{amount} ₽</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={handleLogout}
      >
        <Text style={styles.logoutButtonText}>🚪 Выход из аккаунта</Text>
      </TouchableOpacity>
    </View>
  );

  const renderHelpScreen = () => (
    <View style={styles.section}>
      {renderBackButton()}
      {renderBrandHeader()}
      <Text style={[styles.sectionTitle, { color: textColor }]}>
        ❓ Справка по интерфейсу
      </Text>
      <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
        ℹ️ Краткое описание возможностей beLLum и как ими пользоваться.
      </Text>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          🧭 Главные разделы
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          - 🎯 «Мои привычки» — создавай привычки, нажимай «+1» за каждый выполненный день.{'\n'}
          - 🏆 «Общий челлендж» — недельный челлендж до 10 участников со ставкой 500 ₽.{'\n'}
          - 👤 «Личный кабинет» — смотри статистику успехов, срывов и ставок, меняй аватар.{'\n'}
          - 🌗 Переключатель темы в правом верхнем углу — светлый/тёмный режим интерфейса.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.cardTitle, { color: textColor }]}>
          💸 Деньги и ответственность
        </Text>
        <Text style={[styles.cardSubtitle, { color: secondaryText }]}>
          В разделе челленджа считается призовой фонд: базовый приз + взносы участников. {'\n'}
          ⚠️ Реальные переводы денег и онлайн‑игра между людьми потребуют отдельного сервера и платёжных интеграций — в текущей версии приложение работает как симулятор.
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
              <View style={styles.balanceBadge}>
                <Text style={styles.balanceBadgeText}>
                  💳 Баланс: {balance} ₽
                </Text>
              </View>
            ) : null}
              <TouchableOpacity
                style={[
                  styles.themeButton,
                  { borderColor: isDark ? DARK_TEXT : PURPLE },
                ]}
                onPress={() => setIsDark((prev) => !prev)}
              >
                <Text
                  style={[
                    styles.themeButtonText,
                    { color: isDark ? DARK_TEXT : PURPLE },
                  ]}
                >
                  {isDark ? 'Светлая' : 'Тёмная'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

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
            {isAuthenticated && screen === 'profile' && renderProfileScreen()}
            {isAuthenticated && screen === 'help' && renderHelpScreen()}
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}
