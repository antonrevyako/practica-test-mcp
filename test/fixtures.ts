export const home =
  '<meta name="csrf-token" content="fixture-csrf"><script>var is_logged = true;</script>';
export const fixture = `${home}<title>Test de práctica</title><h1>Test de práctica</h1>
<script>var pais = "ES"; var lang = "es"; var permiso_c = "B"; var tipo = "TDia"; var mode_test = ""; var id_test = "123"; var seguimiento = "memory-only-tracking";</script>
<div id="content-test"><div class="card" id="quest_1"><h4><a>Guardar</a><span>1. ¿Qué opción es correcta?</span></h4>
<div class="watermarked"><img src="/static/img/test/ES/B/example.webp"></div><div class="option_correct">1</div><div class="order_answer">231</div>
<ul class="test_simple"><li id="0005250820"><a>A) Una opción</a></li><li id="0005250830"><a>B) Otra opción</a></li><li id="0005250811"><a>C) La opción correcta</a></li></ul>
<a onclick="enviar_duda('B', 'code-one', '1')">Ver explicación</a></div>
<div class="card" id="quest_2"><h4><span>2. Selecciona dos opciones.</span></h4><div class="order_answer">123</div><ul class="test_simple"><li id="0005250912"><a>A) Primera</a></li><li id="0005250922"><a>B) Segunda</a></li><li id="0005250930"><a>C) Tercera</a></li></ul></div></div><button class="bt-corregir" id="clic"></button>`;
export const manualFixture = `${home}<div class="box_chapter"><div class="title-box">3. Speed</div>
<a href="/en/spanish-driving-test/online?section=13">Test</a>
<a href="/en/book-theory-driving-test/speed/13">Summary</a>
<a href="/en/book-theory-driving-test/speed/13?full=1">Read Full</a></div>
<div class="box_chapter"><div class="title-box">4. Manoeuvres</div><a href="/en/our-plans">Test (Premium)</a>
<a href="/en/book-theory-driving-test/manoeuvres/14">Summary</a><a href="/en/our-plans">Read Full (Premium)</a></div>`;
export const rulesFixture = `${home}<nav>Unrelated navigation</nav><h1>Chapter 3: Speed</h1>
<div class="content-blog"><h2>1. Safe speed</h2><p>Adapt your speed to visibility.</p><ul><li>Leave enough distance.</li></ul>
<table><tr><th>Road</th><th>Limit</th></tr><tr><td>Example</td><td>Illustrative only</td></tr></table>
<img src="/static/img/es/temario/speed-example.jpg" alt="Example speed chart"><script>untrusted()</script><iframe>hidden</iframe></div><footer>Unrelated footer</footer>`;
