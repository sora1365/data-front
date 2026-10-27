import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccesoController } from './acceso.controller';
import { AccesoService } from './acceso.service';
import { CrmAuthGuard } from './crm-auth.guard';

/**
 * La entrada al CRM. El secreto no se pasa aquí sino en cada firma: así, sin
 * `JWT_SECRET` válido el servidor arranca igual y lo que responde es un 503
 * que dice qué falta, en vez de no levantarse. Ojo: el `.env` se lee al
 * arrancar, así que cambiar el secreto pide reiniciar el back.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AccesoController],
  providers: [AccesoService, { provide: APP_GUARD, useClass: CrmAuthGuard }],
  exports: [AccesoService],
})
export class AccesoModule {}
