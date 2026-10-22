CREATE TABLE "search_term_classes" (
	"profile_id" text NOT NULL,
	"search_term" text NOT NULL,
	"branding" text NOT NULL,
	CONSTRAINT "search_term_classes_profile_id_search_term_pk" PRIMARY KEY("profile_id","search_term")
);
