import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import {
  bloqueadoHasta,
  cifrarClave,
  claveCorrecta,
  claveProvisional,
  INTENTOS_MAXIMOS,
  problemaDeClave,
  secretoValido,
} from './acceso.reglas';

/** Quién está detrás de una petición del CRM, tal como lo deja el guardia. */
export interface Sesion {
  username: string;
  administrador: boolean;
  debeCambiarClave: boolean;
}

interface Contexto {
  ip?: string;
  agente?: string;
}

/**
 * Hash de una clave que nadie tiene, para comparar contra algo cuando el
 * usuario no existe. Sin esto, «usuario inexistente» responde en un milisegundo
 * y «clave incorrecta» en cincuenta, y el tiempo de respuesta dice qué
 * usuarios existen.
 */
const HASH_SEÑUELO = cifrarClave('señuelo-que-nadie-puede-escribir');

/**
 * Las filas de un `UPDATE … RETURNING`. TypeORM las devuelve como
 * `[filas, cuántas]` y no como filas, a diferencia de un `INSERT`: leerlo
 * como un `SELECT` da la lista entera como si fuera la primera fila.
 */
const filasDe = (res: any): any[] => (Array.isArray(res?.[0]) ? res[0] : res);

@Injectable()
export class AccesoService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
  ) {}

  private secreto(): string {
    const s = secretoValido(process.env.JWT_SECRET);
    if (!s) {
      throw new ServiceUnavailableException(
        'El servidor no tiene un JWT_SECRET válido: sin él no se puede entrar al CRM.',
      );
    }
    return s;
  }

  // ------------------------------------------------------------------ entrar

  async entrar(usuario: string, clave: string, ctx: Contexto) {
    const secreto = this.secreto();
    usuario = String(usuario ?? '').trim();
    if (!usuario || !clave) throw new BadRequestException('Escribe tu usuario y tu clave.');

    const intentos = await this.dataSource.query(
      `SELECT exito, en FROM crm.acceso WHERE usuario = $1 ORDER BY en DESC LIMIT $2`,
      [usuario, INTENTOS_MAXIMOS],
    );
    const hasta = bloqueadoHasta(intentos.map((i: any) => ({ exito: i.exito, en: new Date(i.en) })));
    if (hasta) {
      await this.anotar(usuario, false, 'bloqueado', ctx);
      const minutos = Math.max(1, Math.ceil((hasta.getTime() - Date.now()) / 60_000));
      throw new HttpException(
        `Demasiados intentos fallidos. Vuelve a probar en ${minutos} min.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const [c] = await this.dataSource.query(
      `SELECT usuario, administrator, disabled, clave_hash, debe_cambiar_clave, sesion_version
         FROM crm.comercial WHERE usuario = $1`,
      [usuario],
    );

    const correcta = claveCorrecta(clave, c?.clave_hash ?? HASH_SEÑUELO);
    // Un solo mensaje para las tres causas: decir «ese usuario no existe» es
    // regalar la mitad del trabajo a quien prueba.
    if (!c || !c.clave_hash || !correcta || c.disabled) {
      const motivo = !c ? 'no existe' : !c.clave_hash ? 'sin clave' : c.disabled ? 'desactivado' : 'clave';
      await this.anotar(usuario, false, motivo, ctx);
      throw new UnauthorizedException('Usuario o clave incorrectos.');
    }

    await this.anotar(usuario, true, null, ctx);
    return this.emitir(c, secreto);
  }

  private emitir(c: any, secreto: string) {
    const token = this.jwt.sign(
      { sub: c.usuario, v: c.sesion_version },
      { secret: secreto, expiresIn: process.env.JWT_EXPIRATION || '12h' },
    );
    return {
      token,
      usuario: c.usuario,
      administrador: c.administrator,
      debeCambiarClave: c.debe_cambiar_clave,
    };
  }

  private anotar(usuario: string, exito: boolean, motivo: string | null, ctx: Contexto) {
    return this.dataSource.query(
      `INSERT INTO crm.acceso (usuario, exito, motivo, ip, agente) VALUES ($1,$2,$3,$4,$5)`,
      [usuario.slice(0, 120), exito, motivo, ctx.ip ?? null, ctx.agente?.slice(0, 300) ?? null],
    );
  }

  // -------------------------------------------------------- comprobar sesión

  /**
   * Quién firma un token, comprobado contra la base en cada petición.
   *
   * Mirar sólo la firma del token dejaría entrar a quien se desactivó ayer
   * hasta que caducara su sesión. Una búsqueda por clave primaria por petición
   * es lo que cuesta que «desactivar» signifique «ya no entra».
   */
  async verificar(token: string): Promise<Sesion> {
    const secreto = this.secreto();
    let carga: { sub: string; v: number };
    try {
      carga = this.jwt.verify(token, { secret: secreto });
    } catch {
      throw new UnauthorizedException('La sesión no es válida o ha caducado.');
    }
    const [c] = await this.dataSource.query(
      `SELECT usuario, administrator, disabled, debe_cambiar_clave, sesion_version
         FROM crm.comercial WHERE usuario = $1`,
      [carga.sub],
    );
    if (!c || c.disabled || c.sesion_version !== carga.v) {
      throw new UnauthorizedException('La sesión ya no es válida. Vuelve a entrar.');
    }
    return {
      username: c.usuario,
      administrador: c.administrator,
      debeCambiarClave: c.debe_cambiar_clave,
    };
  }

  // ------------------------------------------------------------------ claves

  /**
   * Cambiar la propia clave.
   *
   * Pide la actual aunque ya haya sesión: un ordenador que se deja abierto no
   * debería bastar para quedarse con la cuenta. Sube la versión, así que las
   * demás sesiones abiertas —el móvil, el portátil que se olvidó en la
   * oficina— se cierran; la de quien la cambia recibe un token nuevo.
   */
  async cambiarClave(usuario: string, actual: string, nueva: string) {
    const secreto = this.secreto();
    const [c] = await this.dataSource.query(
      `SELECT clave_hash FROM crm.comercial WHERE usuario = $1`,
      [usuario],
    );
    if (!c || !claveCorrecta(String(actual ?? ''), c.clave_hash)) {
      throw new BadRequestException('La clave actual no es correcta.');
    }
    const problema = problemaDeClave(nueva, usuario);
    if (problema) throw new BadRequestException(problema);
    if (claveCorrecta(nueva, c.clave_hash)) {
      throw new BadRequestException('La clave nueva tiene que ser distinta de la actual.');
    }

    const [actualizado] = filasDe(
      await this.dataSource.query(
        `UPDATE crm.comercial
            SET clave_hash = $2, debe_cambiar_clave = false, sesion_version = sesion_version + 1
          WHERE usuario = $1
        RETURNING usuario, administrator, debe_cambiar_clave, sesion_version`,
        [usuario, cifrarClave(nueva)],
      ),
    );
    return this.emitir(actualizado, secreto);
  }

  /**
   * Poner una clave provisional a alguien. Sólo un administrador.
   *
   * La clave se devuelve una vez y no se guarda en claro en ningún sitio: si se
   * pierde, se genera otra. Cierra las sesiones que esa persona tuviera
   * abiertas, porque restablecer es lo que se hace cuando alguien cree que su
   * cuenta está comprometida.
   */
  async restablecer(quien: Sesion, usuario: string) {
    if (!quien.administrador) {
      throw new ForbiddenException('Sólo un administrador puede poner claves.');
    }
    const provisional = claveProvisional();
    const filas = filasDe(
      await this.dataSource.query(
        `UPDATE crm.comercial
            SET clave_hash = $2, debe_cambiar_clave = true, sesion_version = sesion_version + 1
          WHERE usuario = $1
        RETURNING usuario`,
        [usuario, cifrarClave(provisional)],
      ),
    );
    if (filas.length === 0) throw new NotFoundException('Ese comercial no existe.');
    return { usuario, claveProvisional: provisional };
  }

  /**
   * Dar de alta a alguien. Sólo un administrador.
   *
   * Antes los comerciales se creaban solos al firmar su primer cambio; con
   * claves eso ya no puede pasar —sería que cualquiera se inventa una cuenta—,
   * así que el alta es explícita y sale con su clave provisional.
   */
  async alta(
    quien: Sesion,
    datos: { usuario?: string; first_name?: string; last_name?: string; email?: string; administrator?: boolean },
  ) {
    if (!quien.administrador) {
      throw new ForbiddenException('Sólo un administrador puede dar de alta usuarios.');
    }
    const usuario = String(datos?.usuario ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(usuario)) {
      throw new BadRequestException(
        'El usuario va en minúsculas, sin espacios: letras, números, punto, guion (2 a 40).',
      );
    }
    const provisional = claveProvisional();
    const filas = await this.dataSource.query(
      `INSERT INTO crm.comercial
              (usuario, first_name, last_name, email, administrator, clave_hash, debe_cambiar_clave)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (usuario) DO NOTHING
       RETURNING usuario`,
      [
        usuario,
        String(datos.first_name ?? '').trim() || usuario,
        String(datos.last_name ?? '').trim(),
        String(datos.email ?? '').trim(),
        datos.administrator === true,
        cifrarClave(provisional),
      ],
    );
    if (filas.length === 0) {
      throw new BadRequestException(
        'Ese usuario ya existe. Si no puede entrar, restablécele la clave.',
      );
    }
    return { usuario, claveProvisional: provisional };
  }

  /** Las últimas entradas, para el administrador. */
  async accesos(quien: Sesion, usuario?: string) {
    if (!quien.administrador) {
      throw new ForbiddenException('Sólo un administrador puede ver los accesos.');
    }
    return this.dataSource.query(
      `SELECT usuario, exito, motivo, ip, agente, en
         FROM crm.acceso
        WHERE ($1::text IS NULL OR usuario = $1)
        ORDER BY en DESC
        LIMIT 200`,
      [usuario ?? null],
    );
  }
}
