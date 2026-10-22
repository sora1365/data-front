# FRIDAY CRM

Módulo de CRM de FRIDAY, construido sobre [Atomic CRM](https://github.com/marmelab/atomic-crm)
de Marmelab.

## Cambios respecto a Atomic CRM

- La interfaz va en español.
- Las etapas de la oportunidad son las de FRIDAY: por contactar, en
  conversación, propuesta enviada, en negociación, ganada y perdida.
- La categoría de una oportunidad es el **producto** del catálogo de FRIDAY, y
  la actividad sale del CIIU: ninguna de las dos se escribe a mano.
- Los datos viven en el Postgres de FRIDAY, a través de su API, y no en
  Supabase.
