CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  name text, city text, notes text, system text, last_message text,
  stage text NOT NULL DEFAULT 'new',
  unread integer NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  direction text NOT NULL DEFAULT 'customer',
  kind text NOT NULL DEFAULT 'text',
  text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.messages(customer_id, created_at);
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  phone text NOT NULL,
  name text, city text, amount text, details text, invoice_no text, method text,
  status text NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE SEQUENCE public.support_ticket_seq START 1001;
CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no text NOT NULL UNIQUE DEFAULT ('ACTES-SUP-' || nextval('public.support_ticket_seq')::text),
  customer_id uuid REFERENCES public.customers(id),
  phone text NOT NULL,
  name text, city text, device text, issue_type text, description text,
  media_id text, media_type text,
  status text NOT NULL DEFAULT 'open',
  assigned_to text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.support_tickets TO service_role;
GRANT USAGE ON SEQUENCE public.support_ticket_seq TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;