DROP TABLE IF EXISTS todos;
CREATE TABLE IF NOT EXISTS todos
(
    id serial NOT NULL,
    title text COLLATE pg_catalog."default" NOT NULL,
    completed boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT todos_pkey PRIMARY KEY (id)
);
