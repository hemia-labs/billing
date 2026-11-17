---
"api": minor
"web": minor
---

Permite configurar conexiones PayPal por producto desde Integraciones de Billing, con secretos cifrados, webhooks por conexión y conservación de la app original en contratos y reintentos. Añade administración de credenciales actuales e históricas sin exponer secretos en consultas.

El detalle del producto muestra el proveedor y tipo de cobro en modo consulta; la configuración y rotación de credenciales se realizan desde Integraciones, eligiendo primero PayPal y después el producto en un panel lateral con ayuda desplegable.

Separa el borrador de la conexión vigente: guardar conserva los cobros actuales y activar realiza la sustitución de forma transaccional, con controles de concurrencia. El panel usa «Conectar PayPal» y «Producto asociado».

Actualiza las tarjetas de Integraciones y PayPal con icono, descripción breve y pie separado para configurar o consultar, manteniendo estados y permisos reales.

La card de PayPal abre una pantalla propia con conexiones por producto y creación o edición en panel lateral; el mosaico de proveedores deja de mostrar la tabla de conexiones y conserva compatibilidad con enlaces anteriores.

Asocia los IDs de planes y complementos PayPal a su conexión, conserva mappings históricos y fija la conexión y mapping de cada intento. Permite administrar asociaciones por precio sin mezclar apps tras cambiar la conexión vigente. La migración conserva los IDs existentes sin adivinar su app.
