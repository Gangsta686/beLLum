# HabitForge

Мобильное приложение на `Expo`/`React Native` для трекинга привычек и челленджей.

## Supabase Setup

1. Скопируй `.env.example` в `.env`.
2. Заполни значения:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. Установи зависимости (если еще не установлены): `npm install`
4. В Supabase SQL Editor выполни скрипт `supabase/profiles.sql`
   (он создаст таблицу профиля, RLS-политики и хранение баланса пользователя).
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
