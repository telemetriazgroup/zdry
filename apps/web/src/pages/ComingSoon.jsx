export default function ComingSoon({ title, sprint }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      <p className="section-sub">Esta pantalla es del menú de tu rol. La operación entra en el Sprint {sprint}.</p>
      <div className="locked-note">El acceso ya está restringido por cuenta. Un vendedor no puede abrir Configuración ni Personas ni con la URL.</div>
    </div>
  );
}
