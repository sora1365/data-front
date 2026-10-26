import { Module } from '@nestjs/common';
import { PautaController } from './pauta.controller';
import { PautaService } from './pauta.service';

/**
 * Pauta: presupuesto contra gasto real de cada campaña, y su retorno.
 *
 * No importa ningún otro módulo del CRM: los leads, las oportunidades y las
 * ventas se leen por SQL y no se escriben, así que no hay regla de negocio
 * de otro módulo que haya que respetar desde aquí.
 */
@Module({
  controllers: [PautaController],
  providers: [PautaService],
})
export class PautaModule {}
