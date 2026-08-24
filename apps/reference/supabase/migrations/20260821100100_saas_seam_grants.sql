-- ============================================================================
-- Grants for the permissions added in the previous migration.
--
-- Owner only, both of them. Billing changes what the organization is charged,
-- and export produces a complete copy of its data — neither is something an
-- admin should be able to do unilaterally, and both are recoverable only by
-- involving the owner anyway.
-- ============================================================================

insert into public.role_permissions (role, permission) values
  ('owner', 'org.billing'),
  ('owner', 'org.export')
on conflict do nothing;
