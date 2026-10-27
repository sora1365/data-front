import 'reflect-metadata';
import { AppDataSource } from '../src/data-source';
import { cifrarClave, claveProvisional } from '../src/modules/crm/auth/acceso.reglas';

/**
 * Pone una clave provisional a un comercial desde la terminal.
 *
 *     npm run crm:clave -- sora            # clave provisional
 *     npm run crm:clave -- sora --admin    # y además administrador
 *
 * Existe para el primer administrador: las claves las pone un administrador
 * desde el CRM, y el día que se activa la entrada con clave todavía no hay
 * ninguno. Quien tiene acceso a la terminal del servidor ya tiene la base
 * entera, así que esto no abre nada que no estuviera abierto.
 *
 * Si el comercial no existe, lo crea. La clave se enseña una vez y sale
 * marcada para cambiarse al entrar.
 */
async function main() {
  const args = process.argv.slice(2);
  const usuario = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
  const admin = args.includes('--admin');
  if (!usuario) {
    console.error('Uso: npm run crm:clave -- <usuario> [--admin]');
    process.exit(1);
  }

  await AppDataSource.initialize();
  try {
    const provisional = claveProvisional();
    await AppDataSource.query(
      `INSERT INTO crm.comercial (usuario, first_name, clave_hash, debe_cambiar_clave, administrator)
       VALUES ($1, $1, $2, true, $3)
       ON CONFLICT (usuario) DO UPDATE
          SET clave_hash = EXCLUDED.clave_hash,
              debe_cambiar_clave = true,
              sesion_version = crm.comercial.sesion_version + 1,
              administrator = crm.comercial.administrator OR EXCLUDED.administrator`,
      [usuario, cifrarClave(provisional), admin],
    );
    console.log(`Clave provisional de ${usuario}${admin ? ' (administrador)' : ''}: ${provisional}`);
    console.log('Se pide cambiarla al entrar. Las sesiones que tuviera abiertas se cierran.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
