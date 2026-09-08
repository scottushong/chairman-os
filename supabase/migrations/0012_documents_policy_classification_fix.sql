-- Remove the write policy's unintended SELECT classification bypass.
-- Keep documents_read and all existing write predicates unchanged.

drop policy documents_write on public.documents;

create policy documents_insert on public.documents
  as permissive for insert
  with check (has_business(business_id) and can_module('/core/search', true));

create policy documents_update on public.documents
  as permissive for update
  using (has_business(business_id) and can_module('/core/search', true))
  with check (has_business(business_id) and can_module('/core/search', true));

create policy documents_delete on public.documents
  as permissive for delete
  using (has_business(business_id) and can_module('/core/search', true));
