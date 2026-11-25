-- Alembic revision: 0001
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
-- Name: ix_acceptance_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_acceptance_account_id ON public.acceptance USING btree (account_id);


--
-- Name: ix_acceptance_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_acceptance_meeting_id ON public.acceptance USING btree (meeting_id);


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
-- PostgreSQL database dump complete
--

\unrestrict celmentoSchema
