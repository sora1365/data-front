import type { CrmMessages } from "./englishCrmMessages";

/**
 * Los textos del CRM en español.
 *
 * El CRM se usa en Ecuador y la interfaz va en español entera; el código se
 * queda en inglés, que es como vino. El tipo `CrmMessages` obliga a que esta
 * traducción tenga exactamente las mismas claves que la inglesa, así que una
 * clave nueva sin traducir no pasa el `tsc`: no hay forma de que una pantalla
 * amanezca medio en inglés sin que nadie se entere.
 *
 * Dos decisiones de vocabulario, para que no se traduzcan de dos maneras:
 *
 * - `deal` es **oportunidad**, no «trato» ni «negocio», porque es la palabra
 *   que ya usan el back de FRIDAY y la capa comercial.
 * - `company` es **empresa** cuando se habla del cliente del CRM. En FRIDAY
 *   «compañía» es la fila de la Superintendencia, y mezclarlas haría pensar
 *   que son la misma cosa.
 */
export const spanishCrmMessages: CrmMessages = {
  resources: {
    companies: {
      name: "Empresa |||| Empresas",
      forcedCaseName: "Empresa",
      fields: {
        name: "Razón social",
        website: "Sitio web",
        linkedin_url: "LinkedIn",
        phone_number: "Teléfono",
        created_at: "Creada el",
        nb_contacts: "Número de contactos",
        revenue: "Ingresos",
        sector: "Actividad",
        size: "Tamaño",
        tax_identifier: "RUC",
        address: "Dirección",
        city: "Ciudad",
        zipcode: "Código postal",
        state_abbr: "Provincia",
        country: "País",
        description: "Descripción",
        context_links: "Enlaces",
        sales_id: "Comercial",
      },
      empty: {
        description: "Todavía no hay ninguna empresa.",
        title: "Sin empresas",
      },
      import: {
        title: "Importar empresas",
      },
      field_categories: {
        contact: "Contacto",
        additional_info: "Información adicional",
        address: "Dirección",
        context: "Contexto",
      },
      action: {
        create: "Crear empresa",
        edit: "Editar empresa",
        new: "Nueva empresa",
        show: "Ver empresa",
      },
      added_on: "Añadida el %{date}",
      followed_by: "La lleva %{name}",
      followed_by_you: "La llevas tú",
      no_contacts: "Sin contactos",
      nb_contacts: "%{smart_count} contacto |||| %{smart_count} contactos",
      nb_deals: "%{smart_count} oportunidad |||| %{smart_count} oportunidades",
      sizes: {
        one_employee: "1 empleado",
        two_to_nine_employees: "2-9 empleados",
        ten_to_forty_nine_employees: "10-49 empleados",
        fifty_to_two_hundred_forty_nine_employees: "50-249 empleados",
        two_hundred_fifty_or_more_employees: "250 o más empleados",
      },
      autocomplete: {
        create_error: "No se pudo crear la empresa",
        create_item: "Crear %{item}",
        create_label: "Escribe para crear una empresa nueva",
      },
    },
    contacts: {
      name: "Contacto |||| Contactos",
      forcedCaseName: "Contacto",
      field_categories: {
        background_info: "Antecedentes",
        identity: "Identidad",
        misc: "Varios",
        personal_info: "Datos personales",
        position: "Cargo",
      },
      fields: {
        first_name: "Nombre",
        last_name: "Apellidos",
        last_seen: "Último contacto",
        title: "Cargo",
        company_id: "Empresa",
        email_jsonb: "Correos",
        email: "Correo",
        phone_jsonb: "Teléfonos",
        phone_number: "Teléfono",
        linkedin_url: "LinkedIn",
        background: "Antecedentes (quién es, cómo llegó, etc.)",
        has_newsletter: "Recibe el boletín",
        sales_id: "Comercial",
      },
      action: {
        add: "Añadir contacto",
        add_first: "Añade tu primer contacto",
        create: "Crear contacto",
        edit: "Editar contacto",
        export_vcard: "Exportar a vCard",
        new: "Nuevo contacto",
        show: "Ver contacto",
      },
      background: {
        last_activity_on: "Última actividad el %{date}",
        added_on: "Añadido el %{date}",
        followed_by: "Lo lleva %{name}",
        followed_by_you: "Lo llevas tú",
        status_none: "Ninguno",
      },
      position_at: "%{title} en",
      position_at_company: "%{title} en %{company}",
      empty: {
        description: "Todavía no hay ningún contacto.",
        title: "Sin contactos",
      },
      import: {
        title: "Importar contactos",
      },
      inputs: {
        genders: {
          male: "Él",
          female: "Ella",
          nonbinary: "Elle",
        },
        personal_info_types: {
          work: "Trabajo",
          home: "Personal",
          other: "Otro",
        },
      },
      list: {
        error_loading: "No se pudieron cargar los contactos",
      },
      bulk_tag: {
        action: "Etiquetar",
        back: "Volver a las etiquetas",
        create_description:
          "Crea una etiqueta nueva y aplícala a los contactos seleccionados.",
        description:
          "Elige una etiqueta existente o crea una para los contactos seleccionados.",
        empty: "Todavía no hay etiquetas. Crea una para etiquetar los contactos.",
        error: "No se pudo etiquetar a los contactos",
        removed:
          "Etiqueta quitada de %{smart_count} contacto |||| Etiqueta quitada de %{smart_count} contactos",
        success:
          "Etiqueta añadida a %{smart_count} contacto |||| Etiqueta añadida a %{smart_count} contactos",
        title: "Etiquetar contactos",
      },
      merge: {
        action: "Fusionar con otro contacto",
        confirm: "Fusionar contactos",
        current_contact: "Contacto actual (se borrará)",
        description: "Fusiona este contacto con otro.",
        error: "No se pudieron fusionar los contactos",
        merging: "Fusionando…",
        no_additional_data: "No hay datos que fusionar",
        select_target: "Elige el contacto con el que fusionar",
        success: "Contactos fusionados",
        target_contact: "Contacto destino (se conserva)",
        title: "Fusionar contacto",
        warning_description:
          "Todos los datos pasarán al segundo contacto. Esto no se puede deshacer.",
        warning_title: "Atención: esta acción destruye datos",
        what_will_be_merged: "Qué se va a fusionar:",
      },
      filters: {
        before_last_month: "Antes del mes pasado",
        before_this_month: "Antes de este mes",
        before_this_week: "Antes de esta semana",
        managed_by_me: "Los que llevo yo",
        search: "Buscar nombre, empresa…",
        this_week: "Esta semana",
        today: "Hoy",
        tags: "Etiquetas",
        tasks: "Tareas",
      },
      hot: {
        empty_change_status:
          'Para cambiar el estado de un contacto, añádele una nota y pulsa en "mostrar opciones".',
        empty_hint: 'Aquí aparecen los contactos marcados como "caliente".',
        title: "Contactos calientes",
      },
    },
    deals: {
      name: "Oportunidad |||| Oportunidades",
      fields: {
        name: "Nombre",
        description: "Descripción",
        company_id: "Empresa",
        contact_ids: "Contactos",
        category: "Producto",
        amount: "Importe",
        expected_closing_date: "Cierre estimado",
        stage: "Etapa",
      },
      action: {
        back_to_deal: "Volver a la oportunidad",
        create: "Crear oportunidad",
        new: "Nueva oportunidad",
      },
      field_categories: {
        misc: "Varios",
      },
      filters: {
        only_mine: "Sólo las que llevo yo",
      },
      archived: {
        action: "Archivar",
        error: "Error: la oportunidad no se archivó",
        list_title: "Oportunidades archivadas",
        success: "Oportunidad archivada",
        title: "Oportunidad archivada",
        view: "Ver las archivadas",
      },
      inputs: {
        linked_to: "Vinculada a",
      },
      unarchived: {
        action: "Devolver al tablero",
        error: "Error: la oportunidad no se desarchivó",
        success: "Oportunidad desarchivada",
      },
      updated: "Oportunidad actualizada",
      empty: {
        before_create: "antes de crear una oportunidad.",
        description: "Todavía no hay ninguna oportunidad.",
        title: "Sin oportunidades",
      },
      import: {
        title: "Importar oportunidades",
      },
      invalid_date: "Fecha no válida",
    },
    notes: {
      name: "Nota |||| Notas",
      forcedCaseName: "Nota",
      fields: {
        status: "Estado",
        date: "Fecha",
        attachments: "Adjuntos",
        contact_id: "Contacto",
        deal_id: "Oportunidad",
      },
      action: {
        add: "Añadir nota",
        add_first: "Añade tu primera nota",
        delete: "Borrar nota",
        edit: "Editar nota",
        update: "Actualizar nota",
        add_this: "Añadir esta nota",
      },
      sheet: {
        create: "Crear nota",
        create_for: "Crear nota para %{name}",
        edit: "Editar nota",
        edit_for: "Editar la nota de %{name}",
      },
      deleted: "Nota borrada",
      empty: "Todavía no hay notas",
      author_added: "%{name} añadió una nota",
      you_added: "Añadiste una nota",
      me: "Yo",
      list: {
        error_loading: "No se pudieron cargar las notas",
      },
      note_for_contact: "Nota para %{name}",
      stepper: {
        hint: "Entra en un contacto y añádele una nota",
      },
      added: "Nota añadida",
      inputs: {
        add_note: "Añade una nota",
        options_hint: "(adjuntar archivos o cambiar detalles)",
        show_options: "Mostrar opciones",
      },
      actions: {
        attach_document: "Adjuntar documento",
      },
      validation: {
        note_or_attachment_required: "Hace falta una nota o un adjunto",
      },
    },
    sales: {
      name: "Usuario |||| Usuarios",
      fields: {
        first_name: "Nombre",
        last_name: "Apellidos",
        email: "Correo",
        secondary_email: "Correo secundario",
        secondary_emails: "Correos secundarios",
        administrator: "Administrador",
        disabled: "Desactivado",
      },
      create: {
        error: "No se pudo crear el usuario.",
        success:
          "Usuario creado. Recibirá un correo para establecer su contraseña.",
        title: "Crear un usuario",
      },
      edit: {
        error: "Algo falló. Inténtalo de nuevo.",
        record_not_found: "No se encontró el registro",
        success: "Usuario actualizado",
        title: "Editar %{name}",
      },
      action: {
        new: "Nuevo usuario",
      },
    },
    tasks: {
      name: "Tarea |||| Tareas",
      forcedCaseName: "Tarea",
      fields: {
        text: "Descripción",
        due_date: "Vence",
        type: "Tipo",
        contact_id: "Contacto",
        due_short: "vence",
      },
      action: {
        add: "Añadir tarea",
        create: "Crear tarea",
        edit: "Editar tarea",
      },
      actions: {
        postpone_next_week: "Aplazar a la semana que viene",
        postpone_tomorrow: "Aplazar a mañana",
        title: "acciones de la tarea",
      },
      added: "Tarea añadida",
      deleted: "Tarea borrada",
      dialog: {
        create: "Crear tarea",
        create_for: "Crear tarea para %{name}",
      },
      sheet: {
        edit: "Editar tarea",
        edit_for: "Editar la tarea de %{name}",
      },
      empty: "Todavía no hay tareas",
      empty_list_hint: "Aquí aparecen las tareas de tus contactos.",
      filters: {
        later: "Más adelante",
        overdue: "Vencidas",
        this_week: "Esta semana",
        today: "Hoy",
        tomorrow: "Mañana",
        with_pending: "Con tareas pendientes",
      },
      regarding_contact: "(Sobre %{name})",
      updated: "Tarea actualizada",
    },
    tags: {
      name: "Etiqueta |||| Etiquetas",
      action: {
        add: "Añadir etiqueta",
        create: "Crear etiqueta",
      },
      dialog: {
        color: "Color",
        create_title: "Crear una etiqueta",
        edit_title: "Editar etiqueta",
        name_label: "Nombre",
        name_placeholder: "Escribe el nombre",
      },
      empty: "Todavía no hay etiquetas.",
    },
  },
  crm: {
    action: {
      reset_password: "Restablecer la contraseña",
    },
    auth: {
      first_name: "Nombre",
      last_name: "Apellidos",
      confirm_password: "Repite la contraseña",
      confirmation_required:
        "Sigue el enlace que acabamos de enviarte por correo para confirmar tu cuenta.",
      recovery_email_sent:
        "Si tienes cuenta, recibirás en breve un correo para recuperar la contraseña.",
      sign_in_failed: "No se pudo entrar.",
      sign_in_google_workspace: "Entrar con Google Workspace",
      signup: {
        create_account: "Crear cuenta",
        create_first_user:
          "Crea el primer usuario para terminar la instalación.",
        creating: "Creando…",
        initial_user_created: "Primer usuario creado",
      },
      welcome_title: "Bienvenido a FRIDAY CRM",
    },
    common: {
      account_manager: "Comercial",
      activity: "Actividad",
      added: "añadió",
      details: "Detalles",
      last_activity_with_date: "última actividad %{date}",
      load_more: "Cargar más",
      misc: "Varios",
      past: "Pasado",
      read_more: "Leer más",
      retry: "Reintentar",
      show_less: "Mostrar menos",
      copied: "Copiado",
      copy: "Copiar",
      loading: "Cargando…",
      me: "Yo",
      task_count: "%{smart_count} tarea |||| %{smart_count} tareas",
    },
    changelog: {
      title: "Novedades",
    },
    activity: {
      added_company: "%{name} añadió la empresa",
      you_added_company: "Añadiste la empresa",
      added_contact: "%{name} añadió a",
      you_added_contact: "Añadiste a",
      added_note: "%{name} añadió una nota sobre",
      you_added_note: "Añadiste una nota sobre",
      added_note_about_deal: "%{name} añadió una nota sobre la oportunidad",
      you_added_note_about_deal: "Añadiste una nota sobre la oportunidad",
      added_deal: "%{name} añadió la oportunidad",
      you_added_deal: "Añadiste la oportunidad",
      at_company: "en",
      to: "a",
      load_more: "Cargar más actividad",
    },
    dashboard: {
      deals_chart: "Ingresos por cerrar",
      deals_pipeline: "Embudo de ventas",
      latest_activity: "Última actividad",
      latest_activity_error: "No se pudo cargar la actividad",
      latest_notes: "Mis últimas notas",
      latest_notes_added_ago: "hace %{timeAgo}",
      stepper: {
        install: "Instalar FRIDAY CRM",
        progress: "%{step}/3 hecho",
        whats_next: "¿Qué sigue?",
      },
      upcoming_tasks: "Tareas próximas",
    },
    data_import: {
      button: "Importar CSV",
      complete:
        "Importación terminada: %{importCount} registros, con %{errorCount} errores",
      csv_file: "Archivo CSV",
      error:
        "No se pudo importar el archivo. Comprueba que sea un CSV válido.",
      in_progress: "Importando…",
      progress:
        "Importados %{importCount} / %{rowCount} registros, con %{errorCount} errores.",
      remaining_time: "Tiempo restante estimado:",
      resource: "Recurso",
      sample_download: "Descargar un CSV de ejemplo",
      sample_hint: "Este CSV de ejemplo te sirve de plantilla",
      start: "Empezar",
      stop: "Parar",
      stopped:
        "Importación detenida: %{importCount} registros, con %{errorCount} errores",
      title: "Importar datos",
    },
    header: {
      import_data: "Importar desde JSON",
    },
    search: {
      title: "Buscar",
      placeholder: "Buscar contactos, empresas, oportunidades, tareas y notas…",
      hint: "Escribe al menos %{min} caracteres",
      empty: "Sin resultados",
      error: "La búsqueda no está disponible ahora. Inténtalo de nuevo.",
      untitled_result: "(sin título)",
      groups: {
        contacts: "Contactos",
        companies: "Empresas",
        deals: "Oportunidades",
        tasks: "Tareas",
        contact_notes: "Notas de contactos",
        deal_notes: "Notas de oportunidades",
      },
    },
    image_editor: {
      change: "Cambiar",
      drop_hint: "Suelta un archivo aquí, o pulsa para elegirlo.",
      editable_content: "Contenido editable",
      title: "Subir y recortar la imagen",
      update_image: "Actualizar imagen",
    },
    import: {
      action: {
        download_error_report: "Descargar el informe de errores",
        import: "Importar",
        import_another: "Importar otro archivo",
      },
      error: {
        unable: "No se pudo importar el archivo.",
      },
      idle: {
        description_1:
          "Puedes importar usuarios, empresas, contactos, notas y tareas.",
        description_2:
          "Los datos tienen que ir en un JSON como este ejemplo:",
      },
      status: {
        all_success: "Se importaron todos los registros.",
        complete: "Importación terminada.",
        failed: "Fallidos",
        imported: "Importados",
        in_progress: "Importando. No salgas de esta página.",
        some_failed: "Algunos registros no se importaron.",
        table_caption: "Estado de la importación",
      },
      title: "Importar desde JSON",
    },
    settings: {
      about: "Acerca de",
      companies: {
        sectors: "Actividades",
      },
      dark_mode_logo: "Logotipo para el modo oscuro",
      deals: {
        categories: "Productos",
        currency: "Moneda",
        pipeline_help:
          "Elige qué etapas cuentan como oportunidades en el embudo.",
        pipeline_statuses: "Etapas del embudo",
        stages: "Etapas",
      },
      light_mode_logo: "Logotipo para el modo claro",
      notes: {
        statuses: "Estados",
      },
      reset_defaults: "Volver a los valores por defecto",
      save_error: "No se pudo guardar la configuración",
      saved: "Configuración guardada",
      saving: "Guardando…",
      tasks: {
        types: "Tipos",
      },
      preferences: "Preferencias",
      title: "Ajustes",
      app_title: "Nombre de la aplicación",
      sections: {
        branding: "Marca",
      },
      validation: {
        duplicate: "%{display_name} repetidos: %{items}",
        in_use:
          "No se pueden quitar %{display_name} que están en uso por oportunidades: %{items}",
        validating: "Comprobando…",
        entities: {
          categories: "productos",
          stages: "etapas",
        },
      },
    },
    theme: {
      dark: "Oscuro",
      label: "Tema",
      light: "Claro",
      system: "El del sistema",
    },
    language: "Idioma",
    navigation: {
      label: "Navegación del CRM",
    },
    profile: {
      add_secondary_email: "Añadir un correo",
      email_taken: "%{email} ya lo usa otro usuario",
      no_secondary_emails: "Ninguno",
      secondary_email_invalid: "%{email} no es un correo válido",
      secondary_email_is_primary: "%{email} ya es tu dirección principal",
      secondary_email_taken: "%{email} ya lo usa otro usuario",
      too_many_secondary_emails:
        "No puedes añadir más de 10 correos secundarios",
      secondary_emails_help:
        "Otras direcciones desde las que escribes. Deja una vacía para quitarla.",
      inbound: {
        description:
          "Puedes escribir a la dirección de entrada de tu servidor, por ejemplo poniéndola en el campo %{field}. FRIDAY CRM procesará esos correos y los añadirá como notas al contacto correspondiente.",
        title: "Correo de entrada",
      },
      mcp: {
        title: "Servidor MCP",
        description:
          "Usa esta dirección para conectar tu asistente de IA a los datos del CRM por el Model Context Protocol (MCP).",
      },
      password: {
        change: "Cambiar la contraseña",
      },
      password_reset_sent:
        "Te hemos enviado un correo para restablecer la contraseña",
      record_not_found: "No se encontró el registro",
      title: "Perfil",
      updated: "Tu perfil se ha actualizado",
      update_error: "Algo falló. Inténtalo de nuevo",
    },
    validation: {
      invalid_url: "Tiene que ser una dirección válida",
      invalid_linkedin_url: "La dirección tiene que ser de linkedin.com",
    },
  },
};
