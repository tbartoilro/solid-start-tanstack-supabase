-- ============================================================================
-- Permissions for the two capabilities a SaaS template needs a hook for but
-- should not implement on the consumer's behalf.
--
--   org.billing  Subscriptions, seats and payment method. Deliberately not
--                implemented here — baking in one payment provider is the
--                fastest way to make a template useless to anyone who prefers
--                another. What is provided is the permission to gate it on, so
--                a consumer's billing UI has something to check from day one.
--                The rbac migration's own comment already promised the owner
--                "manages billing"; this makes that real.
--
--   org.export   Tenant-scoped data export. Someone has to be able to answer a
--                GDPR access request, and "the owner, through a permission" is
--                a better answer than "an engineer, through psql".
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it,
-- and the Supabase CLI runs each migration file in its own transaction — which
-- is why the grants live in the next migration rather than here.
-- ============================================================================

alter type public.app_permission add value if not exists 'org.billing';
alter type public.app_permission add value if not exists 'org.export';
