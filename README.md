# HabitForge

Мобильное приложение на `Expo`/`React Native` для трекинга привычек и челленджей.

## Supabase Setup

1. Скопируй `.env.example` в `.env`.
2. Заполни значения:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. Установи зависимости (если еще не установлены): `npm install`
4. В Supabase SQL Editor выполни скрипты по порядку:
   1. `supabase/profiles.sql` — базовые профили, RLS, баланс, недельный челлендж.
   2. `supabase/migrations.sql` — расширения для геймификации, соцфич, аналитики:
      - расширяет `public.profiles` полями `xp`, `level`, `language`, `theme`, `push_token`, `notifications_enabled`, `referral_code`, `referred_by`, `current_streak`, `best_streak`;
      - создаёт таблицы `habit_completions`, `user_achievements`, `friendships`, `private_challenges`, `private_challenge_participants`, `activity_feed`, `activity_reactions`, `peer_reviews`, `admin_audit`, `admin_users`;
      - добавляет RPC `create_private_challenge`, `join_private_challenge_by_code`, `admin_top_up_safe`;
      - создаёт view `public.all_time_leaderboard`.
   3. `supabase/payments.sql` — пополнение баланса картой / СБП / SEPA через
      крипто-шлюзы:
      - таблица `public.payment_invoices` (RLS: юзер видит только свои);
      - RPC `create_invoice_record`, `attach_provider_invoice`, `confirm_payment`
        (последняя — идемпотентная, повторный webhook не задвоит баланс);
      - функция `expire_stale_invoices` для крон-задачи;
      - view `public.my_invoices`.
5. Запусти проект: `npm run start`

Клиент Supabase инициализируется в `lib/supabase.js`.
Авторизация в приложении (`регистрация/вход/выход`) выполняется через `supabase.auth`.
Баланс и имя пользователя синхронизируются через таблицу `public.profiles`.

## Быстрое пополнение баланса (1 команда)

После выполнения `supabase/profiles.sql` доступны helper-функции:

- Пополнить одному пользователю на 500 по умолчанию:
  - `select * from public.admin_top_up('user@example.com');`
- Пополнить одному пользователю на произвольную сумму:
  - `select * from public.admin_top_up('user@example.com', 1500);`
- Пополнить сразу нескольким пользователям:
  - `select * from public.admin_top_up_many(array['u1@example.com', 'u2@example.com'], 500);`
- Пополнить одному пользователю на 500 (самый короткий вариант):
  - `select * from public.admin_top_up_default('user@example.com');`
- Пополнить нескольким пользователям из одной строки:
  - `select * from public.admin_top_up_from_text('u1@example.com, u2@example.com, u3@example.com', 500);`

`target` можно передавать как `email` или `display_name`.

Для просмотра зарегистрированных пользователей с почтой и балансом:

- `select * from public.users_with_profiles;`

## Что нового (геймификация, соцфичи, аналитика)

После применения `supabase/migrations.sql` в приложении становятся доступны:

- **XP и уровни.** За выполнение привычек начисляются очки опыта (`lib/xp.js`),
  каждый уровень даёт +5% к призу за победу в челлендже (`prizeMultiplier`).
- **Серии и фриз-дни.** `lib/streak.js` считает текущую и лучшую серию с учётом
  одного «прощённого» пропуска. Значения сохраняются в `profiles.current_streak`
  и `profiles.best_streak`.
- **Достижения.** Список в `lib/achievements.js`, новые ачивки автоматически
  записываются в `public.user_achievements` и показываются в профиле в виде сетки.
- **Локализация.** `lib/i18n.js` поддерживает русский и английский, язык
  сохраняется в `profiles.language` и в `AsyncStorage`.
- **Тёмная/светлая темы.** Палитра в `lib/theme.js`, выбор сохраняется в
  `profiles.theme` и переключателем в профиле.
- **Push-уведомления.** `lib/notifications.js` (Expo Notifications) — напоминания
  по времени для каждой привычки, push-токен синхронизируется с `profiles.push_token`.
- **Хаптика.** `lib/haptics.js` (Expo Haptics) даёт тактильный отклик на ключевые
  действия: выполнение привычки, победа в челлендже, ошибки.
- **Активность и friends.** Лента событий в `public.activity_feed`,
  реакции в `public.activity_reactions`, друзья в `public.friendships`.
- **Приватные челленджи.** Комнаты по 6-значному коду через RPC
  `create_private_challenge` / `join_private_challenge_by_code` и таблицы
  `public.private_challenges`, `public.private_challenge_participants`.
- **Лидерборд.** Глобальный рейтинг по XP — view `public.all_time_leaderboard`.
- **Peer-review.** В общем недельном челлендже участники голосуют 👍/🚩 за других
  (таблица `public.peer_reviews`).
- **CSV-экспорт.** Кнопка в профиле выгружает привычки и историю выполнений
  через `expo-file-system` + `expo-sharing` (`lib/csv.js`, `lib/export.js`).
- **Безопасные пополнения.** RPC `admin_top_up_safe` пишет историю в
  `public.admin_audit` и проверяет права через `public.admin_users`.

### Новые зависимости Expo

`npm install` поднимет всё разом, но новые пакеты отдельно:

```
expo-notifications
expo-haptics
expo-file-system
expo-sharing
expo-localization
react-native-svg
```

После их установки на iOS/Android может потребоваться очистка кэша Expo
(`npx expo start -c`).

### Тесты

Юнит-тесты (`tests/*.test.js`) проверяют чистую логику без RN/Expo:

```
npm test
```

Покрыто: `challengeUtils`, `streak`, `xp`, `achievements`, `csv`, `payments`.

## Пополнение баланса картой / СБП / SEPA (без Google/Apple Pay)

Архитектура двух-провайдерного чекаута:

```
   App ──► create-invoice (Edge Function) ──► CryptoCloud / Cryptomus ──► USDT нам
                                                       │
                                                       ▼
                                       payments-webhook (Edge Function)
                                                       │
                                                       ▼
                                          confirm_payment (RPC, идемпотентна)
                                                       │
                                                       ▼
                                            profiles.balance += ₽
```

- **CryptoCloud** — основной провайдер для **RU + СНГ**: Visa/MC RU, Мир, СБП,
  ЮMoney, QIWI.
- **Cryptomus** — основной провайдер для **EU + Global**: Visa/MC EU/UK/US,
  SEPA, Apple/Google Pay.
- Сторона юзера: KYC не нужен в пределах лимитов провайдера
  (~700 €/день, ~3000 €/месяц).
- На балансе у юзера всегда рубли, FX-курс фиксируется в момент создания
  инвойса (`payment_invoices.fx_rate`).

### Edge Functions

Папка `supabase/functions/`:

- `create-invoice/` — создаёт запись `payment_invoices`, дёргает API провайдера
  и возвращает клиенту `pay_url`.
- `payments-webhook/` — обрабатывает callbackы по двум маршрутам:
  - `POST /payments-webhook/cryptomus` — проверяет MD5-подпись.
  - `POST /payments-webhook/cryptocloud` — проверяет HMAC-SHA256.
  - на «paid» вызывает `confirm_payment` (идемпотентно).
- `_shared/providers/` — переиспользуемые клиенты двух провайдеров.

Деплой:

```
supabase functions deploy create-invoice
supabase functions deploy payments-webhook --no-verify-jwt
```

Секреты Edge Functions (Supabase → Project Settings → Edge Functions →
Secrets) — список в `.env.example`. Для локальной разработки можно
использовать `supabase functions serve --env-file ./supabase/.env.payments`.

### Где это работает / где не работает

- ✅ **Web (PWA), Telegram Mini App, APK напрямую** — без ограничений.
- ❌ **App Store / Google Play** — Apple/Google требуют IAP для in-app валюты.
  Под сторы публикуй либо без денежных челленджей, либо через IAP-обвязку.

### Антифрод и идемпотентность

- `payment_invoices.expires_at` (по умолчанию +30 минут) +
  `expire_stale_invoices()` — крон-задача `select public.expire_stale_invoices();`
  каждые 5 минут (через `pg_cron`).
- `unique (provider, provider_invoice_id)` — один инвойс провайдера = одна запись.
- `confirm_payment(p_invoice_id)` идемпотентна: на уже `paid` инвойсе ничего не меняет.
- Все сигнатуры провайдеров верифицируются на стороне Edge Function до
  записи в БД.
