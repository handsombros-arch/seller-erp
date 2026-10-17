BEGIN;
CREATE TABLE public.rg_snapshot_verification_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_key text NOT NULL,
 request_key text NOT NULL, actor uuid, trigger_kind text NOT NULL CHECK (trigger_kind IN ('manual','scheduled')),
 state text NOT NULL CHECK (state IN ('READING','COMPLETE','FAILED','EXPIRED')),
 error_code text NOT NULL DEFAULT 'NONE', lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
 lease_until timestamptz, started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 snapshot_date date NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')::date,
 page_count integer NOT NULL DEFAULT 0, expected_cursor text DEFAULT '',
 seen_cursors text[] NOT NULL DEFAULT '{}', items jsonb NOT NULL DEFAULT '[]',
 row_count integer NOT NULL DEFAULT 0, content_hash text,
 approved_for_schedule boolean NOT NULL DEFAULT false, schedule_pinned_at timestamptz, scheduled_request_key text,
 UNIQUE(account_key,request_key)
);
CREATE UNIQUE INDEX rg_snapshot_verification_active ON public.rg_snapshot_verification_runs(account_key) WHERE state='READING';
CREATE UNIQUE INDEX rg_snapshot_verification_one_pin ON public.rg_snapshot_verification_runs(approved_for_schedule) WHERE approved_for_schedule;
ALTER TABLE public.rg_snapshot_verification_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rg_snapshot_verification_runs FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.rg_verify_hash(p_items jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT encode(sha256(convert_to(COALESCE(string_agg(
  octet_length(x->>'id')::text||':'||(x->>'id')||'|'||
  CASE WHEN x->'external_id'='null'::jsonb THEN '-1:' ELSE octet_length(x->>'external_id')::text||':'||(x->>'external_id') END||'|'||
  ((x->>'quantity')::bigint)::text||'|'||((x->>'sales_30d')::bigint)::text,
  E'\n' ORDER BY (x->>'id') COLLATE "C"),''),'UTF8')),'hex') FROM jsonb_array_elements(p_items) x;
$$;
CREATE FUNCTION public.rg_verify_summary(p public.rg_snapshot_verification_runs) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('run_id',p.id,'state',p.state,'error_code',p.error_code,
 'trigger_kind',p.trigger_kind,'started_utc',p.started_at,'finished_utc',p.finished_at,
 'snapshot_date',p.snapshot_date,'pages',p.page_count,'rows',p.row_count,
 'content_hash',p.content_hash,'schedule_pinned',p.approved_for_schedule,'lease_expired',p.state='READING' AND p.lease_until<clock_timestamp());
$$;

CREATE FUNCTION public.rg_verify_claim(p_account_key text,p_request_key text,p_actor uuid,p_trigger text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.rg_snapshot_verification_runs;
BEGIN
 IF p_account_key IS NULL OR p_request_key IS NULL OR p_trigger IS NULL OR p_account_key !~ '^[a-f0-9]{64}$' OR length(p_request_key)>100 OR p_trigger NOT IN ('manual','scheduled') OR
  (p_trigger='manual' AND (p_actor IS NULL OR p_request_key !~ '^manual:[a-f0-9-]{36}$')) OR
  (p_trigger='scheduled' AND p_request_key !~ '^scheduled:[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN RAISE EXCEPTION 'INVALID_SCOPE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account_key,0));
 SELECT * INTO r FROM public.rg_snapshot_verification_runs WHERE account_key=p_account_key AND request_key=p_request_key;
 IF FOUND THEN
  IF p_trigger='manual' AND r.actor IS DISTINCT FROM p_actor THEN RETURN jsonb_build_object('claimed',false,'state','BLOCKED','error_code','REQUEST_SCOPE_REJECTED'); END IF;
  RETURN public.rg_verify_summary(r)||jsonb_build_object('claimed',false); END IF;
 UPDATE public.rg_snapshot_verification_runs SET state='EXPIRED',error_code='LEASE_EXPIRED',finished_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE account_key=p_account_key AND state='READING' AND lease_until<=clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.rg_snapshot_verification_runs WHERE account_key=p_account_key AND state='READING') THEN
  RETURN jsonb_build_object('claimed',false,'state','BUSY','error_code','ACCOUNT_BUSY'); END IF;
 IF p_trigger='scheduled' AND NOT EXISTS(SELECT 1 FROM public.rg_snapshot_verification_runs WHERE account_key=p_account_key AND state='COMPLETE' AND approved_for_schedule AND scheduled_request_key=p_request_key) THEN
  RETURN jsonb_build_object('claimed',false,'state','BLOCKED','error_code','MANUAL_VERIFICATION_NOT_PINNED'); END IF;
 INSERT INTO public.rg_snapshot_verification_runs(account_key,request_key,actor,trigger_kind,state,lease_until)
 VALUES(p_account_key,p_request_key,p_actor,p_trigger,'READING',clock_timestamp()+interval '90 seconds') RETURNING * INTO r;
 RETURN public.rg_verify_summary(r)||jsonb_build_object('claimed',true,'lease_token',r.lease_token);
END;
$$;

CREATE FUNCTION public.rg_verify_stage(p_run uuid,p_lease uuid,p_cursor text,p_next text,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.rg_snapshot_verification_runs; merged jsonb; failure text;
BEGIN
 SELECT * INTO r FROM public.rg_snapshot_verification_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR r.state<>'READING' OR r.lease_token IS DISTINCT FROM p_lease OR r.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
 IF r.snapshot_date<>(clock_timestamp() AT TIME ZONE 'UTC')::date THEN failure:='DATE_EXPIRED';
 ELSIF r.page_count>=50 OR p_cursor IS NULL OR r.expected_cursor IS NULL OR p_cursor IS DISTINCT FROM r.expected_cursor OR md5(p_cursor)=ANY(r.seen_cursors) OR
  (p_next IS NOT NULL AND (p_next=p_cursor OR md5(p_next)=ANY(r.seen_cursors))) THEN failure:='PAGE_LIMIT_OR_REPEAT';
 ELSIF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>1000 THEN failure:='INVALID_PAGE';
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE
   jsonb_typeof(x)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(x))<>4 OR
   NOT(x ?& ARRAY['id','external_id','quantity','sales_30d']) OR jsonb_typeof(x->'id')<>'string' OR
   jsonb_typeof(x->'quantity')<>'number' OR jsonb_typeof(x->'sales_30d')<>'number' OR (x->>'id') !~ '^[0-9]{1,32}$' OR
   (x->>'quantity') !~ '^[0-9]{1,16}$' OR (x->>'sales_30d') !~ '^[0-9]{1,16}$' OR
   (x->>'quantity')::numeric>9007199254740991 OR (x->>'sales_30d')::numeric>9007199254740991 OR
   jsonb_typeof(x->'external_id') NOT IN ('string','null') OR length(x->>'external_id')>128) THEN failure:='INVALID_ROW';
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(r.items||p_items) x GROUP BY x->>'id' HAVING count(DISTINCT x)>1) THEN failure:='CONFLICTING_DUPLICATE';
  ELSE
   SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'id') COLLATE "C"),'[]'::jsonb) INTO merged
    FROM (SELECT DISTINCT x FROM jsonb_array_elements(r.items||p_items) x) s;
   IF jsonb_array_length(merged)>1000 THEN failure:='ROW_LIMIT'; END IF;
  END IF;
 END IF;
 IF failure IS NOT NULL THEN
  UPDATE public.rg_snapshot_verification_runs SET state='FAILED',error_code=failure,updated_at=clock_timestamp(),finished_at=clock_timestamp() WHERE id=p_run RETURNING * INTO r;
 ELSE
  UPDATE public.rg_snapshot_verification_runs SET items=merged,row_count=jsonb_array_length(merged),page_count=page_count+1,
   expected_cursor=p_next,seen_cursors=array_append(seen_cursors,md5(p_cursor)),updated_at=clock_timestamp() WHERE id=p_run RETURNING * INTO r;
 END IF;
 RETURN public.rg_verify_summary(r);
END;
$$;

CREATE FUNCTION public.rg_verify_finish(p_run uuid,p_lease uuid,p_expected_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.rg_snapshot_verification_runs; h text;
BEGIN
 SELECT * INTO r FROM public.rg_snapshot_verification_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR r.state<>'READING' OR r.lease_token IS DISTINCT FROM p_lease OR r.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
 IF r.expected_cursor IS NOT NULL OR r.page_count<1 THEN RAISE EXCEPTION 'INCOMPLETE'; END IF;
 h:=public.rg_verify_hash(r.items);
 UPDATE public.rg_snapshot_verification_runs SET state=CASE WHEN h=p_expected_hash THEN 'COMPLETE' ELSE 'FAILED' END,
  error_code=CASE WHEN h=p_expected_hash THEN 'NONE' ELSE 'HASH_MISMATCH' END,
  content_hash=h,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_run RETURNING * INTO r;
 RETURN public.rg_verify_summary(r);
END;
$$;
CREATE FUNCTION public.rg_verify_fail(p_run uuid,p_lease uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.rg_snapshot_verification_runs;
BEGIN
 IF p_code NOT IN ('PROVIDER_NETWORK','PROVIDER_HTTP','PROVIDER_INVALID','BUDGET_LIMIT','ROW_LIMIT','PAGE_LIMIT','CURSOR_REPEAT') THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;
 UPDATE public.rg_snapshot_verification_runs SET state='FAILED',error_code=p_code,finished_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=p_run AND lease_token=p_lease AND state='READING' RETURNING * INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
 RETURN public.rg_verify_summary(r);
END;
$$;
CREATE FUNCTION public.rg_verify_status(p_request_key text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.rg_snapshot_verification_runs; h text;
BEGIN
 SELECT * INTO r FROM public.rg_snapshot_verification_runs WHERE request_key=p_request_key AND
  (actor=p_actor OR trigger_kind='scheduled') ORDER BY started_at DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','NOT_FOUND','error_code','NOT_FOUND'); END IF;
 IF r.state='COMPLETE' THEN h:=public.rg_verify_hash(r.items); END IF;
 RETURN public.rg_verify_summary(r)||jsonb_build_object('independent_rows',CASE WHEN r.state='COMPLETE' THEN jsonb_array_length(r.items) ELSE NULL END,
  'matches',CASE WHEN r.state='COMPLETE' THEN h=r.content_hash AND jsonb_array_length(r.items)=r.row_count ELSE false END);
END;
$$;
CREATE FUNCTION public.rg_verify_schedule_pin(p_run uuid,p_slot text DEFAULT 'scheduled:'||((clock_timestamp() AT TIME ZONE 'UTC')::date)::text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.rg_snapshot_verification_runs;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('rg-verification-schedule-pin',0));
 IF p_slot IS NULL OR p_slot NOT IN ('scheduled:'||((clock_timestamp() AT TIME ZONE 'UTC')::date)::text,'scheduled:'||(((clock_timestamp() AT TIME ZONE 'UTC')::date)+1)::text) THEN RAISE EXCEPTION 'INVALID_SCHEDULE_SLOT'; END IF;
 SELECT * INTO r FROM public.rg_snapshot_verification_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR r.state<>'COMPLETE' OR r.trigger_kind<>'manual' OR r.content_hash IS DISTINCT FROM public.rg_verify_hash(r.items) OR r.row_count<>jsonb_array_length(r.items) THEN RAISE EXCEPTION 'VERIFIED_MANUAL_REQUIRED'; END IF;
 UPDATE public.rg_snapshot_verification_runs SET approved_for_schedule=false WHERE approved_for_schedule;
 UPDATE public.rg_snapshot_verification_runs SET approved_for_schedule=true,schedule_pinned_at=clock_timestamp(),scheduled_request_key=p_slot WHERE id=p_run RETURNING * INTO r;
 RETURN public.rg_verify_summary(r);
END;
$$;
REVOKE ALL ON FUNCTION public.rg_verify_hash(jsonb),public.rg_verify_summary(public.rg_snapshot_verification_runs),
 public.rg_verify_claim(text,text,uuid,text),public.rg_verify_stage(uuid,uuid,text,text,jsonb),
 public.rg_verify_finish(uuid,uuid,text),public.rg_verify_fail(uuid,uuid,text),public.rg_verify_status(text,uuid),public.rg_verify_schedule_pin(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rg_verify_claim(text,text,uuid,text),public.rg_verify_stage(uuid,uuid,text,text,jsonb),
 public.rg_verify_finish(uuid,uuid,text),public.rg_verify_fail(uuid,uuid,text),public.rg_verify_status(text,uuid),public.rg_verify_schedule_pin(uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
