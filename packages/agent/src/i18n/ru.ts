import type { Texts } from './en';

export const ru: Texts = {
  noteSame: 'то же значение (===): обновление пропущено',
  noteUndefined: 'undefined: обновление пропущено',
  noteFiltered: 'filter вернул false: target не вызван',
  outOfScopeTitle: (unit: string) => `Вызов вне scope: ${unit}`,
  outOfScopeDetail: (unit: string) =>
    `${unit} вызван вне scope, хотя приложение использует fork(). Изменение ушло в глобальный граф, а приложение читает свой scope и его не видит. Обычно это вызов из setTimeout, сокета, стороннего колбэка или прямой вызов вместо useUnit.`,
  outOfScopeFix: (unit: string) =>
    `Привяжите вызов до выхода из эффекта: const fn = scopeBind(${unit}), или вызывайте через useUnit. Для колбэка, который может сработать вообще без scope, — scopeBind(${unit}, { safe: true })`,
  doubleTitle: (unit: string) => `${unit} обновлён больше одного раза за транзакцию`,
  doubleDetail:
    'Стор пересчитался дважды за один проход. effector упорядочивает шаги combine и sample по порядку объявления, а не по графу, поэтому потребитель, объявленный раньше источников, сначала читает старое значение.',
  doubleFix: (unit: string) =>
    `Объявите ${unit} после юнитов, которые его питают, или соберите его через combine вместо цепочки sample`,
  blockedTitle: (unit: string) => `${unit} остановлен filter`,
  blockedDetail:
    'filter вернул false, target не вызван. Откройте транзакцию, чтобы увидеть значения source и filter.',
  errorTitle: (unit: string) => `Исключение в ${unit}`,
  errorDetail: (message: string) =>
    `${message}. effector пишет ошибку в консоль и останавливает только эту ветку: соседние ветки уже применились, поэтому производные сторы могут разойтись с источниками.`,
  errorFix:
    'Редьюсеры и функции маппинга должны быть чистыми и не бросать исключений; рискованный код — в эффект',
  failTitle: (unit: string) => `${unit} завершился ошибкой`,
  cycleTitle: (unit: string) => `Возможный бесконечный цикл от ${unit}`,
  cycleDetail: (stepLimit: number) =>
    `Одна транзакция выполнила больше ${stepLimit} шагов. Синхронный цикл через события не останавливается и вешает вкладку; цикл через сторы останавливается, когда значение перестаёт меняться.`,
  cycleFix: 'Откройте Graph и найдите цикл, который проходит только через события',
  noSidTitle: (count: number, total: number) => `У ${count} из ${total} сторов нет sid`,
  noSidDetail: (names: string) =>
    `${names}. serialize(scope) молча пропускает их, а записанный трейс сопоставит их только по имени. Перемещение во времени в пределах страницы работает.`,
  noSidFix: 'Подключите effector/babel-plugin или @effector/swc-plugin для этих файлов',
  dupTitle: (sid: string) => `Повторяющийся sid ${sid}`,
  dupDetail: (names: string) =>
    `У ${names} один sid: serialize, гидрация и подмена хендлеров их перепутают. Обычно фабрика не указана в factories плагина или плагин применён дважды.`,
  dupFix:
    'Добавьте фабрику в опцию factories плагина; @withease/factories с invoke() выдаёт каждому экземпляру свой sid',
  globalTitle: 'Глобальный режим: нет fork()',
  globalDetail:
    'Перемещение во времени записывает значения на месте через launch: watchers, sample и эффекты на это реагируют, поэтому результат не гарантирован. Воспроизведение подменяет хендлеры эффектов глобально.',
  globalFix:
    'Лучше использовать fork() и рендерить приложение внутри <DeffectorProvider value={scope}>',
  noAdapterTitle: 'Используется scope, но приложение не обёрнуто в DeffectorProvider',
  noAdapterDetail:
    'Без адаптера deffector не может показать scope из прошлого, поэтому переход записывает значения в живой scope на месте.',
  noAdapterFix:
    "Замените Provider из effector на DeffectorProvider из '@deffector/agent/react' (или /vue, /solid)",
  conflictTitle: 'Другой инструмент перехватил инспектор effector',
  conflictDetail:
    'В effector один слот инспектора. effector/inspect (его используют effector-logger и @effector/redux-devtools-adapter) загрузился после deffector и заменил его: новые транзакции не записываются.',
  conflictFix:
    'Уберите другой инструмент в разработке или импортируйте его до @deffector/agent. Кнопка «Вернуть» в панели забирает слот обратно.',
  okCycles: 'Зацикливаний нет',
  okCyclesDetail: (stepLimit: number) =>
    `Ни одна транзакция не выполнила больше ${stepLimit} шагов.`,
  unknownStep: (unit: string) => `неизвестный юнит ${unit}: шаг пропущен`,
  silentEdit: 'fork({values}) и подмена scope: watchers и эффекты не запускались',
  replayLabel: (who: string) => `воспроизведение: ${who}`,
  jumpScope: (name: string, id: number) => `${name} @ #${id}`,
  pastTitle: (transactionId: number) =>
    `deffector: приложение показывает транзакцию #${transactionId}`,
  pastBack: 'Вернуться в настоящее',
  pastUnlock: 'Разрешить клики',
  pastHint: 'клики заблокированы, чтобы не изменить прошлое',
  pausedTitle: 'История до открытия панели не записана',
  pausedDetail: (seconds: number) =>
    `Агент стоит на паузе, пока DevTools закрыты (первые ${seconds} с после загрузки он пишет, поэтому DevTools можно открыть и перезагрузить страницу — начало сохранится).`,
  pausedFix:
    'Откройте DevTools и перезагрузите страницу, чтобы записать с самого начала, или задайте attachDeffector({ whileClosed: "record" })',
  stopTitle: 'deffector остановил бесконечный цикл',
  stopDetail: (stepCount: number, names: string) =>
    `Один синхронный проход ядра превысил ${stepCount} шагов. deffector оборвал распространение, чтобы вкладка не зависла; состояние может быть обновлено частично. Чаще всего выполнялись: ${names}.`,
  stopFix:
    'Найдите цикл в Graph (он проходит через эти юниты) и разорвите его filter-ом или вынесите вызов из watcher',
  eventCycleTitle: (names: string) => `Цикл только через события: ${names}`,
  eventCycleDetail:
    'События вызывают друг друга без стора между ними. Если filter его не остановит, один вызов зациклится и повесит вкладку.',
  eventCycleFix:
    'Добавьте filter или проведите цикл через стор (стор останавливается, когда значение перестаёт меняться)',
  storeCycleTitle: (names: string) => `Цикл через стор: ${names}`,
  storeCycleDetail:
    'Заканчивается, когда значение стора перестаёт меняться. Для сходящейся логики это нормально; если значение каждый раз новое (счётчик, новый объект), цикл идёт до лимита шагов.',
  sidMismatchTitle: (count: number) => `${count} значени(й) с сервера не нашли стор на клиенте`,
  sidMismatchDetail: (sids: string) =>
    `fork({ values }) / hydrate получил sid, которых нет на клиенте: ${sids}. Либо сервер и клиент собирают модель по-разному (опции плагина, factories), либо модуль ещё не загружен.`,
  sidMismatchFix:
    'Используйте одинаковую конфигурацию babel/swc-плагина на сервере и клиенте; перечислите фабрики в опциях плагина',
  derivedWriteTitle: (unit: string) => `В производный стор ${unit} пишут напрямую`,
  derivedWriteDetail:
    'Стор из map/combine получил значение от sample или события. В effector 22 это устарело: следующее обновление источников перезапишет значение, а до этого стор и источники расходятся. effector 23 запрещает такую запись, поэтому после обновления это станет ошибкой на старте.',
  derivedWriteFix: (unit: string) =>
    `Сделайте ${unit} обычным стором (createStore + .on/sample) или пишите в его источники`,
  staleReadTitle: (reader: string, store: string) => `${reader} прочитал ${store} до обновления`,
  staleReadDetail: (store: string) =>
    `В той же транзакции ${store} изменился уже после того, как sample взял значение, поэтому sample использовал старое. effector упорядочивает sample по объявлению и приоритету, а не по потоку данных.`,
  staleReadFix: (store: string) =>
    `Запускайте sample от ${store} (clock: ${store}) или объявите его после юнитов, которые обновляют ${store}`,
  inconsistentTitle: (count: number) => `${count} производн(ых) стор(ов) разошлись с источниками`,
  inconsistentDetail: (names: string) =>
    `${names}: значение отличается от пересчёта из текущих источников. Обычно после исключения в map/combine или прямой записи в производный стор.`,
  inconsistentFix:
    'Посмотрите последнюю транзакцию с ошибкой и исправьте функцию, которая бросает исключение',
  consistentTitle: 'Производные сторы совпадают с источниками',
  leakTitle: (unit: string, count: number) => `${unit} создан ${count} раз`,
  leakDetail: (where: string) =>
    `Юниты из ${where} создаются заново после старта приложения. Юниты, созданные в компоненте, watcher-е или эффекте, не собираются сборщиком мусора и ломают SSR (новые sid).`,
  leakFix:
    'Создавайте модель один раз на уровне модуля или экземпляр фабрики вне рендера (useMemo не спасает в StrictMode)',
  lateTitle: (count: number) => `${count} юнит(ов) создано после старта`,
  lateDetail: (files: string) =>
    `${files}. Лениво загруженные чанки делают это один раз, это нормально; повторное создание показывается отдельно.`,
  skippedChildren: (names: string) => `Не выполнились из-за исключения: ${names}`,
};
