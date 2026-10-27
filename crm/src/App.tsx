import { CRM } from "@/components/atomic-crm/root/CRM";
import {
  authProvider,
  dataProvider,
} from "@/components/atomic-crm/providers/friday";
import { FirmaPage } from "@/components/atomic-crm/providers/friday/FirmaPage";

/**
 * El CRM de FRIDAY.
 *
 * Los proveedores son los de FRIDAY y no los de Supabase: los datos viven en
 * el Postgres del proyecto, detrás del API de NestJS. La pantalla de entrada
 * pide usuario y clave; las cuentas las da de alta un administrador.
 */
const App = () => (
  <CRM
    dataProvider={dataProvider}
    authProvider={authProvider}
    loginPage={FirmaPage}
  />
);

export default App;
