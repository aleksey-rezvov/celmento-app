-- Alembic revision: 0004
--
-- PostgreSQL database dump
--

\restrict celmentoSchema

-- Dumped from database version 19.0 (Debian 19.0-2.pgdg13+1)
-- Dumped by pg_dump version 19.0 (Debian 19.0-2.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: acceptance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acceptance (
    acceptance_id uuid DEFAULT uuidv7() NOT NULL,
    account_id uuid,
    meeting_id uuid,
    kind text NOT NULL,
    version text,
    accepted_at timestamp with time zone NOT NULL,
    CONSTRAINT acceptance_has_one_subject CHECK (((account_id IS NULL) <> (meeting_id IS NULL))),
    CONSTRAINT acceptance_requires_document_version CHECK (((kind = 'age_confirmation'::text) = (version IS NULL)))
);


--
-- Name: account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account (
    account_id uuid DEFAULT uuidv7() NOT NULL,
    email text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    login text NOT NULL,
    language text NOT NULL,
    time_zone text NOT NULL,
    phone text,
    telegram text,
    whatsapp text,
    photo_key text,
    activated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_first_name_length CHECK (((length(first_name) >= 1) AND (length(first_name) <= 100))),
    CONSTRAINT account_last_name_length CHECK (((length(last_name) >= 1) AND (length(last_name) <= 100)))
);


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: balance_operation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_operation (
    balance_operation_id uuid DEFAULT uuidv7() NOT NULL,
    client_card_id uuid NOT NULL,
    kind text NOT NULL,
    amount numeric(19,4) NOT NULL,
    currency text NOT NULL,
    currency_version integer NOT NULL,
    date date NOT NULL,
    comment text,
    meeting_id uuid,
    created_by_system boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT balance_operation_amount_finite CHECK (((amount > '-Infinity'::numeric) AND (amount < 'Infinity'::numeric))),
    CONSTRAINT balance_operation_currency_known CHECK ((currency = ANY (ARRAY['RUB'::text, 'EUR'::text, 'USD'::text]))),
    CONSTRAINT balance_operation_currency_version_valid CHECK ((currency_version >= 1)),
    CONSTRAINT balance_operation_kind_known CHECK ((kind = ANY (ARRAY['payment'::text, 'session_charge'::text, 'missed_charge'::text, 'refund_to_balance'::text, 'deleted_meeting_charge'::text, 'correction'::text]))),
    CONSTRAINT balance_operation_payment_valid CHECK ((((kind <> 'payment'::text) AND created_by_system) OR ((kind = 'payment'::text) AND (NOT created_by_system) AND (amount > (0)::numeric) AND (meeting_id IS NULL))))
);


--
-- Name: client_card; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_card (
    client_card_id uuid DEFAULT uuidv7() NOT NULL,
    leader_account_id uuid NOT NULL,
    name text NOT NULL,
    photo_key text,
    phone text,
    email text,
    telegram text,
    whatsapp text,
    other_contact text,
    preferred_channel text,
    self_given_email text,
    rate numeric(19,4),
    currency text NOT NULL,
    currency_version integer DEFAULT 1 NOT NULL,
    payment_type text NOT NULL,
    request text,
    goals text,
    info text,
    hypotheses text,
    status text DEFAULT 'active'::text NOT NULL,
    archived_at timestamp with time zone,
    linked_account_id uuid,
    link_method text,
    unlinked_by_client_at timestamp with time zone,
    auto_link_blocked boolean DEFAULT false NOT NULL,
    is_new boolean DEFAULT false NOT NULL,
    source text NOT NULL,
    guest_language text,
    guest_time_zone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_card_archive_time_matches_status CHECK (((status = 'archived'::text) = (archived_at IS NOT NULL))),
    CONSTRAINT client_card_currency_known CHECK ((currency = ANY (ARRAY['RUB'::text, 'EUR'::text, 'USD'::text]))),
    CONSTRAINT client_card_currency_version_valid CHECK ((currency_version >= 1)),
    CONSTRAINT client_card_guest_language_known CHECK ((guest_language = ANY (ARRAY['ru'::text, 'en'::text]))),
    CONSTRAINT client_card_link_excludes_leader CHECK ((linked_account_id IS DISTINCT FROM leader_account_id)),
    CONSTRAINT client_card_link_has_method CHECK (((linked_account_id IS NULL) = (link_method IS NULL))),
    CONSTRAINT client_card_link_method_known CHECK ((link_method = ANY (ARRAY['auto'::text, 'login'::text]))),
    CONSTRAINT client_card_name_nonempty CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT client_card_new_only_from_booking CHECK (((NOT is_new) OR (source = 'booked_via_link'::text))),
    CONSTRAINT client_card_paid_rate_valid CHECK (((payment_type <> 'paid'::text) OR (rate IS NULL) OR (rate > (0)::numeric))),
    CONSTRAINT client_card_payment_type_known CHECK ((payment_type = ANY (ARRAY['paid'::text, 'pro_bono'::text, 'barter'::text]))),
    CONSTRAINT client_card_preferred_channel_known CHECK ((preferred_channel = ANY (ARRAY['phone'::text, 'email'::text, 'telegram'::text, 'whatsapp'::text, 'other'::text]))),
    CONSTRAINT client_card_rate_valid CHECK (((rate >= (0)::numeric) AND (rate < 'Infinity'::numeric))),
    CONSTRAINT client_card_self_given_email_normalized CHECK (((self_given_email <> ''::text) AND (self_given_email = lower(btrim(self_given_email))))),
    CONSTRAINT client_card_source_known CHECK ((source = ANY (ARRAY['created'::text, 'booked_via_link'::text]))),
    CONSTRAINT client_card_status_known CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: client_request_receipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_request_receipt (
    client_request_receipt_id uuid DEFAULT uuidv7() NOT NULL,
    leader_account_id uuid NOT NULL,
    client_card_id uuid NOT NULL,
    operation text NOT NULL,
    idempotency_key uuid NOT NULL,
    request_digest text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_request_receipt_digest_valid CHECK ((request_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT client_request_receipt_operation_known CHECK ((operation = ANY (ARRAY['create_client'::text, 'create_client_payment'::text])))
);


--
-- Name: feedback_message; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_message (
    feedback_message_id uuid DEFAULT uuidv7() NOT NULL,
    account_id uuid NOT NULL,
    activated boolean NOT NULL,
    screen text NOT NULL,
    text text NOT NULL,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feedback_message_screen_known CHECK ((screen = 'profile'::text)),
    CONSTRAINT feedback_message_text_length CHECK (((length(text) >= 1) AND (length(text) <= 5000)))
);


--
-- Name: leader_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leader_profile (
    account_id uuid NOT NULL,
    specializations text[] DEFAULT '{}'::text[] NOT NULL,
    specialization_other text,
    about text DEFAULT ''::text NOT NULL,
    contact_email text,
    links text[] DEFAULT '{}'::text[] NOT NULL,
    main_channel text,
    session_duration_minutes integer,
    session_format text,
    default_meeting_link text,
    default_rate numeric(19,4),
    default_currency text,
    preseeded_notes_version integer,
    CONSTRAINT leader_profile_about_length CHECK ((length(about) <= 1000)),
    CONSTRAINT leader_profile_default_currency_known CHECK ((default_currency = ANY (ARRAY['RUB'::text, 'EUR'::text, 'USD'::text]))),
    CONSTRAINT leader_profile_default_rate_valid CHECK (((default_rate >= (0)::numeric) AND (default_rate < 'Infinity'::numeric))),
    CONSTRAINT leader_profile_main_channel_known CHECK ((main_channel = ANY (ARRAY['phone'::text, 'telegram'::text, 'whatsapp'::text, 'email'::text]))),
    CONSTRAINT leader_profile_maximum_links CHECK ((cardinality(links) <= 5)),
    CONSTRAINT leader_profile_session_duration_known CHECK ((session_duration_minutes = ANY (ARRAY[15, 30, 45, 60, 75, 90]))),
    CONSTRAINT leader_profile_session_format_known CHECK ((session_format = ANY (ARRAY['online'::text, 'in_person'::text, 'both'::text]))),
    CONSTRAINT leader_profile_specializations_known CHECK ((specializations <@ ARRAY['coach'::text, 'psychologist'::text, 'psychotherapist'::text, 'psychoanalyst'::text, 'consultant'::text, 'mentor'::text, 'other'::text]))
);


--
-- Name: legal_document_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_document_version (
    legal_document_version_id uuid DEFAULT uuidv7() NOT NULL,
    document text NOT NULL,
    version text NOT NULL,
    title_ru text NOT NULL,
    title_en text NOT NULL,
    text_ru text NOT NULL,
    text_en text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: meeting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting (
    meeting_id uuid DEFAULT uuidv7() NOT NULL,
    leader_account_id uuid NOT NULL,
    type text NOT NULL,
    client_card_id uuid,
    with_whom text,
    topic text,
    starts_at timestamp with time zone NOT NULL,
    duration_minutes integer NOT NULL,
    my_duration_minutes integer,
    actual_duration_minutes integer,
    place text NOT NULL,
    meeting_link text,
    address text,
    price numeric(19,4),
    currency text,
    currency_version integer,
    payment_type text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    charged boolean,
    comment text,
    source text NOT NULL,
    client_comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meeting_actual_duration_matches_status CHECK ((((status = 'completed'::text) = (actual_duration_minutes IS NOT NULL)) AND ((actual_duration_minutes IS NULL) OR (actual_duration_minutes > 0)))),
    CONSTRAINT meeting_charge_decision_matches_status CHECK (((status = 'not_taken_place'::text) = (charged IS NOT NULL))),
    CONSTRAINT meeting_client_fields_match_type CHECK ((((type = 'client_session'::text) = (client_card_id IS NOT NULL)) AND ((type = 'client_session'::text) = (payment_type IS NOT NULL)) AND ((type = 'client_session'::text) = (currency_version IS NOT NULL)))),
    CONSTRAINT meeting_client_has_no_with_whom CHECK (((type <> 'client_session'::text) OR ((with_whom IS NULL) AND (topic IS NULL)))),
    CONSTRAINT meeting_currency_known CHECK ((currency = ANY (ARRAY['RUB'::text, 'EUR'::text, 'USD'::text]))),
    CONSTRAINT meeting_currency_version_valid CHECK ((currency_version >= 1)),
    CONSTRAINT meeting_duration_valid CHECK ((duration_minutes > 0)),
    CONSTRAINT meeting_location_matches_place CHECK ((((meeting_link IS NULL) OR (place = 'online'::text)) AND ((address IS NULL) OR (place = 'in_person'::text)))),
    CONSTRAINT meeting_own_duration_valid CHECK ((((type = 'mutual_practice'::text) = (my_duration_minutes IS NOT NULL)) AND ((my_duration_minutes IS NULL) OR ((my_duration_minutes >= 1) AND (my_duration_minutes <= duration_minutes))))),
    CONSTRAINT meeting_paid_price_valid CHECK (((payment_type <> 'paid'::text) OR (price > (0)::numeric))),
    CONSTRAINT meeting_payment_type_known CHECK ((payment_type = ANY (ARRAY['paid'::text, 'pro_bono'::text, 'barter'::text]))),
    CONSTRAINT meeting_place_known CHECK ((place = ANY (ARRAY['online'::text, 'in_person'::text]))),
    CONSTRAINT meeting_price_matches_type CHECK ((((type = 'mutual_practice'::text) = (price IS NULL)) AND ((type = 'mutual_practice'::text) = (currency IS NULL)))),
    CONSTRAINT meeting_price_valid CHECK (((price >= (0)::numeric) AND (price < 'Infinity'::numeric))),
    CONSTRAINT meeting_source_known CHECK ((source = ANY (ARRAY['specialist'::text, 'self_booked'::text]))),
    CONSTRAINT meeting_status_known CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'not_taken_place'::text]))),
    CONSTRAINT meeting_type_known CHECK ((type = ANY (ARRAY['client_session'::text, 'personal_therapy'::text, 'supervision'::text, 'training'::text, 'mutual_practice'::text])))
);


--
-- Name: meeting_create_receipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_create_receipt (
    meeting_create_receipt_id uuid DEFAULT uuidv7() NOT NULL,
    leader_account_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    meeting_id uuid,
    request_digest text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meeting_create_receipt_digest_valid CHECK ((request_digest ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: meeting_expense_correction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_expense_correction (
    meeting_expense_correction_id uuid DEFAULT uuidv7() CONSTRAINT meeting_expense_correction_meeting_expense_correction__not_null NOT NULL,
    meeting_id uuid NOT NULL,
    amount numeric(19,4) NOT NULL,
    currency text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT meeting_expense_correction_amount_valid CHECK (((amount <> (0)::numeric) AND (amount > '-Infinity'::numeric) AND (amount < 'Infinity'::numeric))),
    CONSTRAINT meeting_expense_correction_currency_known CHECK ((currency = ANY (ARRAY['RUB'::text, 'EUR'::text, 'USD'::text])))
);


--
-- Name: notice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notice (
    notice_id uuid DEFAULT uuidv7() NOT NULL,
    account_id uuid NOT NULL,
    tab text NOT NULL,
    key text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    dismissed_at timestamp with time zone,
    CONSTRAINT notice_key_known CHECK ((key = ANY (ARRAY['notify.limit_new_client'::text, 'notify.archived_client_tried'::text, 'notify.invite_registered'::text, 'client.linked_notice'::text, 'notify.rescheduled'::text, 'notify.cancelled'::text, 'admin.access_granted'::text]))),
    CONSTRAINT notice_params_object CHECK ((jsonb_typeof(params) = 'object'::text)),
    CONSTRAINT notice_tab_known CHECK ((tab = ANY (ARRAY['people'::text, 'meetings'::text, 'profile'::text])))
);


--
-- Name: reserved_login_word; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reserved_login_word (
    reserved_login_word_id text NOT NULL,
    source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reserved_login_word_source CHECK ((source = ANY (ARRAY['builtin'::text, 'admin'::text])))
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    session_id uuid DEFAULT uuidv7() NOT NULL,
    account_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: sign_in_ticket; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sign_in_ticket (
    sign_in_ticket_id uuid DEFAULT uuidv7() NOT NULL,
    account_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: subscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription (
    account_id uuid NOT NULL,
    until date NOT NULL,
    granted_by text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: working_day; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.working_day (
    account_id uuid NOT NULL,
    weekday text NOT NULL,
    working boolean NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    CONSTRAINT working_day_order CHECK (((NOT working) OR (end_time > start_time))),
    CONSTRAINT working_day_quarter_hours CHECK ((((EXTRACT(minute FROM start_time) % (15)::numeric) = (0)::numeric) AND (EXTRACT(second FROM start_time) = (0)::numeric) AND (EXTRACT(hour FROM start_time) < (24)::numeric) AND ((EXTRACT(minute FROM end_time) % (15)::numeric) = (0)::numeric) AND (EXTRACT(second FROM end_time) = (0)::numeric) AND (EXTRACT(hour FROM end_time) < (24)::numeric))),
    CONSTRAINT working_day_weekday_known CHECK ((weekday = ANY (ARRAY['mon'::text, 'tue'::text, 'wed'::text, 'thu'::text, 'fri'::text, 'sat'::text, 'sun'::text])))
);


--
-- Name: acceptance acceptance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acceptance
    ADD CONSTRAINT acceptance_pkey PRIMARY KEY (acceptance_id);


--
-- Name: account account_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_email_key UNIQUE (email);


--
-- Name: account account_login_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_login_key UNIQUE (login);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (account_id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: balance_operation balance_operation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_operation
    ADD CONSTRAINT balance_operation_pkey PRIMARY KEY (balance_operation_id);


--
-- Name: client_card client_card_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_card
    ADD CONSTRAINT client_card_pkey PRIMARY KEY (client_card_id);


--
-- Name: client_request_receipt client_request_receipt_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_request_receipt
    ADD CONSTRAINT client_request_receipt_key_unique UNIQUE (leader_account_id, operation, idempotency_key);


--
-- Name: client_request_receipt client_request_receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_request_receipt
    ADD CONSTRAINT client_request_receipt_pkey PRIMARY KEY (client_request_receipt_id);


--
-- Name: feedback_message feedback_message_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_message
    ADD CONSTRAINT feedback_message_pkey PRIMARY KEY (feedback_message_id);


--
-- Name: leader_profile leader_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_profile
    ADD CONSTRAINT leader_profile_pkey PRIMARY KEY (account_id);


--
-- Name: legal_document_version legal_document_version_document_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_document_version
    ADD CONSTRAINT legal_document_version_document_version_key UNIQUE (document, version);


--
-- Name: legal_document_version legal_document_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_document_version
    ADD CONSTRAINT legal_document_version_pkey PRIMARY KEY (legal_document_version_id);


--
-- Name: meeting_create_receipt meeting_create_receipt_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_create_receipt
    ADD CONSTRAINT meeting_create_receipt_key_unique UNIQUE (leader_account_id, idempotency_key);


--
-- Name: meeting_create_receipt meeting_create_receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_create_receipt
    ADD CONSTRAINT meeting_create_receipt_pkey PRIMARY KEY (meeting_create_receipt_id);


--
-- Name: meeting_expense_correction meeting_expense_correction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_expense_correction
    ADD CONSTRAINT meeting_expense_correction_pkey PRIMARY KEY (meeting_expense_correction_id);


--
-- Name: meeting meeting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT meeting_pkey PRIMARY KEY (meeting_id);


--
-- Name: notice notice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notice
    ADD CONSTRAINT notice_pkey PRIMARY KEY (notice_id);


--
-- Name: reserved_login_word reserved_login_word_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reserved_login_word
    ADD CONSTRAINT reserved_login_word_pkey PRIMARY KEY (reserved_login_word_id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (session_id);


--
-- Name: session session_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_hash_key UNIQUE (token_hash);


--
-- Name: sign_in_ticket sign_in_ticket_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sign_in_ticket
    ADD CONSTRAINT sign_in_ticket_pkey PRIMARY KEY (sign_in_ticket_id);


--
-- Name: sign_in_ticket sign_in_ticket_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sign_in_ticket
    ADD CONSTRAINT sign_in_ticket_token_hash_key UNIQUE (token_hash);


--
-- Name: subscription subscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription
    ADD CONSTRAINT subscription_pkey PRIMARY KEY (account_id);


--
-- Name: working_day working_day_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_day
    ADD CONSTRAINT working_day_pkey PRIMARY KEY (account_id, weekday);


--
-- Name: client_card_leader_linked_account_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_card_leader_linked_account_unique ON public.client_card USING btree (leader_account_id, linked_account_id) WHERE (linked_account_id IS NOT NULL);


--
-- Name: ix_acceptance_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_acceptance_account_id ON public.acceptance USING btree (account_id);


--
-- Name: ix_acceptance_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_acceptance_meeting_id ON public.acceptance USING btree (meeting_id);


--
-- Name: ix_balance_operation_client_card_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_balance_operation_client_card_id ON public.balance_operation USING btree (client_card_id);


--
-- Name: ix_balance_operation_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_balance_operation_meeting_id ON public.balance_operation USING btree (meeting_id);


--
-- Name: ix_client_card_leader_account_id_self_given_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_client_card_leader_account_id_self_given_email ON public.client_card USING btree (leader_account_id, self_given_email);


--
-- Name: ix_client_card_linked_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_client_card_linked_account_id ON public.client_card USING btree (linked_account_id);


--
-- Name: ix_client_card_self_given_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_client_card_self_given_email ON public.client_card USING btree (self_given_email);


--
-- Name: ix_client_request_receipt_client_card_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_client_request_receipt_client_card_id ON public.client_request_receipt USING btree (client_card_id);


--
-- Name: ix_feedback_message_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_feedback_message_account_id ON public.feedback_message USING btree (account_id);


--
-- Name: ix_meeting_client_card_id_starts_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_meeting_client_card_id_starts_at ON public.meeting USING btree (client_card_id, starts_at);


--
-- Name: ix_meeting_create_receipt_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_meeting_create_receipt_meeting_id ON public.meeting_create_receipt USING btree (meeting_id);


--
-- Name: ix_meeting_expense_correction_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_meeting_expense_correction_meeting_id ON public.meeting_expense_correction USING btree (meeting_id);


--
-- Name: ix_meeting_leader_account_id_starts_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_meeting_leader_account_id_starts_at ON public.meeting USING btree (leader_account_id, starts_at);


--
-- Name: ix_notice_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_notice_account_id ON public.notice USING btree (account_id);


--
-- Name: ix_session_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_session_account_id ON public.session USING btree (account_id);


--
-- Name: ix_sign_in_ticket_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sign_in_ticket_account_id ON public.sign_in_ticket USING btree (account_id);


--
-- Name: legal_document_version_document_uploaded_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_document_version_document_uploaded_at_idx ON public.legal_document_version USING btree (document, uploaded_at);


--
-- Name: acceptance acceptance_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acceptance
    ADD CONSTRAINT acceptance_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(account_id) ON DELETE RESTRICT;


--
-- Name: balance_operation balance_operation_client_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_operation
    ADD CONSTRAINT balance_operation_client_card_id_fkey FOREIGN KEY (client_card_id) REFERENCES public.client_card(client_card_id) ON DELETE RESTRICT;


--
-- Name: client_card client_card_leader_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_card
    ADD CONSTRAINT client_card_leader_account_id_fkey FOREIGN KEY (leader_account_id) REFERENCES public.account(account_id) ON DELETE RESTRICT;


--
-- Name: client_card client_card_linked_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_card
    ADD CONSTRAINT client_card_linked_account_id_fkey FOREIGN KEY (linked_account_id) REFERENCES public.account(account_id) ON DELETE RESTRICT;


--
-- Name: client_request_receipt client_request_receipt_client_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_request_receipt
    ADD CONSTRAINT client_request_receipt_client_card_id_fkey FOREIGN KEY (client_card_id) REFERENCES public.client_card(client_card_id) ON DELETE RESTRICT;


--
-- Name: client_request_receipt client_request_receipt_leader_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_request_receipt
    ADD CONSTRAINT client_request_receipt_leader_account_id_fkey FOREIGN KEY (leader_account_id) REFERENCES public.account(account_id) ON DELETE RESTRICT;


--
-- Name: feedback_message feedback_message_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_message
    ADD CONSTRAINT feedback_message_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(account_id) ON DELETE RESTRICT;


--
-- Name: balance_operation fk_balance_operation_meeting_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_operation
    ADD CONSTRAINT fk_balance_operation_meeting_id FOREIGN KEY (meeting_id) REFERENCES public.meeting(meeting_id) ON DELETE SET NULL;


--
-- Name: leader_profile leader_profile_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_profile
    ADD CONSTRAINT leader_profile_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(account_id) ON DELETE CASCADE;


--
-- Name: meeting meeting_client_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT meeting_client_card_id_fkey FOREIGN KEY (client_card_id) REFERENCES public.client_card(client_card_id) ON DELETE RESTRICT;


--
-- Name: meeting_create_receipt meeting_create_receipt_leader_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_create_receipt
    ADD CONSTRAINT meeting_create_receipt_leader_account_id_fkey FOREIGN KEY (leader_account_id) REFERENCES public.account(account_id) ON DELETE RESTRICT;


--
-- Name: meeting_create_receipt meeting_create_receipt_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_create_receipt
    ADD CONSTRAINT meeting_create_receipt_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meeting(meeting_id) ON DELETE SET NULL;


--
-- Name: meeting_expense_correction meeting_expense_correction_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_expense_correction
    ADD CONSTRAINT meeting_expense_correction_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meeting(meeting_id) ON DELETE CASCADE;


--
-- Name: meeting meeting_leader_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT meeting_leader_account_id_fkey FOREIGN KEY (leader_account_id) REFERENCES public.account(account_id) ON DELETE RESTRICT;


--
-- Name: notice notice_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notice
    ADD CONSTRAINT notice_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(account_id) ON DELETE CASCADE;


--
-- Name: session session_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(account_id) ON DELETE CASCADE;


--
-- Name: sign_in_ticket sign_in_ticket_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sign_in_ticket
    ADD CONSTRAINT sign_in_ticket_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(account_id) ON DELETE CASCADE;


--
-- Name: subscription subscription_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription
    ADD CONSTRAINT subscription_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.account(account_id) ON DELETE CASCADE;


--
-- Name: working_day working_day_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_day
    ADD CONSTRAINT working_day_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.leader_profile(account_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict celmentoSchema
