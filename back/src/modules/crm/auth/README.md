# Entrar al CRM

Usuario y clave, con sesión firmada (JWT) y comprobada contra la base en cada
petición. Cubre el «roles y seguridad» de la fase 1 de `Requerimientos CRM.pdf`
y la parte del módulo 16 que no depende de terceros.

## Primer arranque

1. `JWT_SECRET` en `back/.env`: al menos 32 caracteres y **no** el de ejemplo
   (`your-secret-key…`), que se rechaza igual que si faltara. Sin secreto válido
   el CRM responde 503 al entrar: cerrado, no abierto. El `.env` se lee al
   arrancar, así que cambiarlo pide reiniciar el back.
2. `npm run migration:run`
3. El primer administrador, desde la terminal del servidor:

   ```bash
   npm run crm:clave -- sora --admin
   ```

   Enseña una clave provisional una vez. Al entrar se pide cambiarla.
4. Los demás, desde el CRM: **Usuarios → Crear**, que devuelve su clave
   provisional. Si alguien la pierde, **Restablecer clave** en su ficha.

## Lo que hace

| Ruta | Qué |
|---|---|
| `POST /crm/auth/entrar` | `{usuario, clave}` → `{token, usuario, administrador, debeCambiarClave}` |
| `GET /crm/auth/yo` | Quién firma la sesión |
| `POST /crm/auth/clave` | `{actual, nueva}`: cambia la propia y devuelve sesión nueva |
| `POST /crm/auth/usuarios` | Alta (administrador) → clave provisional |
| `POST /crm/auth/usuarios/:u/restablecer` | Clave provisional nueva (administrador) |
| `GET /crm/auth/accesos?usuario=` | Últimas 200 entradas, buenas y malas (administrador) |

Para probar con `curl`, la sesión va en `Authorization: Bearer <token>`.
`X-Usuario` ya no sirve en `/crm`.

## Decisiones

**El guardia cierra por defecto.** Es global y vigila todo `/crm`; lo que no
lleva `@Publico()` pide sesión. Una ruta nueva que se olvide de declararlo
queda protegida, no abierta. Son públicas, y cada una lo lleva escrito: el
formulario de leads, ver/aceptar/rechazar una proforma, la encuesta de
postventa, la baja y el píxel de los correos, el webhook de WhatsApp (que
comprueba la firma de Meta) y el API del contable (que tiene su propia llave).

**Sólo `/crm`.** El gestor comercial (el 3000) no tiene todavía pantalla de
acceso y sigue firmando con `X-Usuario`. Protegerlo en el mismo cambio lo
dejaba sin poder entrar.

**La sesión se comprueba contra la base en cada petición**, no sólo su firma.
Es una búsqueda por clave primaria, y es lo que hace que desactivar a alguien o
restablecerle la clave le cierre la sesión en la siguiente petición en vez de
cuando caduque. `sesion_version` sube al cambiar la clave: todas las sesiones
anteriores dejan de valer.

**Con sesión, la cabecera `X-Usuario` se ignora.** Si mandara ella, cualquiera
con cuenta firmaría en nombre de otro.

**Las claves**: scrypt con sal, parámetros guardados en cada hash para poder
subirlos sin invalidar las de hoy. Se exige largo (10), no mezclas de símbolos:
esas reglas producen `Empresa2026!`. La provisional no lleva caracteres que se
confunden al dictarla (0/O, 1/l/I).

**Un solo mensaje para «no existe», «sin clave», «desactivado» y «clave
incorrecta»**, y el mismo tiempo de respuesta (se compara contra un hash
señuelo cuando el usuario no existe). Distinguirlos le dice a quien prueba qué
usuarios existen. El motivo real sí queda en `crm.acceso`.

**Bloqueo por usuario, no por IP**: cinco fallos seguidos bloquean 15 minutos.
Por IP, una oficina detrás del mismo router se bloquearía por el despiste de
una persona. Sale de `crm.acceso`, sin contador aparte que se desincronice.

**Usuarios (`sales`)**: cada uno cambia su nombre, correo y avatar; dar de
alta, desactivar y nombrar administradores es de un administrador, que no puede
quitarse el permiso ni desactivarse a sí mismo (dejaría el CRM sin nadie que dé
altas).

## Lo que falta

- **Permisos por registro** (módulos 13 y 16): hoy un comercial ve todas las
  oportunidades y clientes. El rol sólo decide quién gestiona usuarios.
- **Segundo factor** (MFA).
- **Auditoría de cambios campo a campo** en clientes y oportunidades, e
  historial de exportaciones.
- El gestor comercial (3000) sigue sin acceso con clave.
