import * as vscode from 'vscode';

// Интерфейс для хранения структуры статистических данных
interface PomodoroStats {
	completed_cycles: number;
	total_work_seconds: number;
	total_break_seconds: number;
	blocked_execution_attempts: number;
	early_break_stops: number;
	history: any[];
}

export function activate(context: vscode.ExtensionContext) {
	// Создание элементов строки состояния (Status Bar) для управления таймером
	const kTimerButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 105);
	const kStartButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 104);
	const kPauseButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 103);
	const kResetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
	const kStatsButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);

	// Инициализация основных переменных таймера
	let seconds_left = 25 * 60;
	let is_running = false;
	let current_mode: string = 'work'; // Текущий режим: 'work' или 'break'
	let timer_id: any = undefined; // Переменная для хранения интервала setInterval

	// Чтение статистики из постоянной памяти globalState
	let stats_data: any = context.globalState.get('pomodoro_stats_data');
	if (stats_data === undefined || stats_data === null) {
		stats_data = {
			completed_cycles: 0,
			total_work_seconds: 0,
			total_break_seconds: 0,
			blocked_execution_attempts: 0,
			early_break_stops: 0,
			history: []
		};
	}

	if (stats_data.history === undefined || stats_data.history === null) {
		stats_data.history = [];
	}

	// Восстановление состояния таймера после перезапуска VS Code
	const kSavedState: any = context.workspaceState.get('pomodoro_timer_state');
	if (kSavedState !== undefined && kSavedState !== null) {
		current_mode = kSavedState.mode;
		if (kSavedState.is_running === true) {
			const kNow = Date.now();
			if (kNow < kSavedState.end_timestamp) {
				// Расчет оставшегося времени на основе сохраненной метки завершения
				seconds_left = Math.round((kSavedState.end_timestamp - kNow) / 1000);
				is_running = true;
				StartTicks();
			} else {
				context.workspaceState.update('pomodoro_timer_state', undefined);
				ResetTimerValue();
			}
		} else {
			seconds_left = kSavedState.seconds_left;
			is_running = false;
		}
	} else {
		ResetTimerValue();
	}

	// Сброс и установка времени таймера в зависимости от текущего режима
	function ResetTimerValue() {
		const kConfig = vscode.workspace.getConfiguration('pomodoro');
		if (current_mode === 'work') {
			seconds_left = kConfig.get<number>('workDuration', 25) * 60;
		} else {
			const kCyclesBeforeLong = kConfig.get<number>('cyclesBeforeLongBreak', 4);
			// Если количество циклов кратно заданному значению - ставим длинный перерыв
			if (stats_data.completed_cycles % kCyclesBeforeLong === 0 && stats_data.completed_cycles > 0) {
				seconds_left = kConfig.get<number>('longBreakDuration', 15) * 60;
			} else {
				seconds_left = kConfig.get<number>('shortBreakDuration', 5) * 60;
			}
		}
	}

	// Обновление текстовой информации и иконок в интерфейсе строки состояния
	function UpdateDisplay() {
		const kMinutes = Math.floor(seconds_left / 60).toString().padStart(2, '0');
		const kSeconds = (seconds_left % 60).toString().padStart(2, '0');

		let icon_str = "🔥";
		let mode_str = "Work";
		if (current_mode !== 'work') {
			icon_str = "🌴";
			mode_str = "Break";
		}

		kTimerButton.text = `${icon_str} [${mode_str}] ${kMinutes}:${kSeconds}`;
		kStartButton.text = "$(play)";
		kPauseButton.text = "$(debug-pause)";
		kResetButton.text = "$(refresh)";
		kStatsButton.text = "$(graph)";

		kTimerButton.show();
		kStartButton.show();
		kPauseButton.show();
		kResetButton.show();
		kStatsButton.show();
	}

	// Сохранение текущего времени в workspaceState для защиты от перезагрузки
	function SaveCurrentState() {
		const kEndTimestamp = Date.now() + seconds_left * 1000;
		context.workspaceState.update('pomodoro_timer_state', {
			mode: current_mode,
			is_running: is_running,
			seconds_left: seconds_left,
			end_timestamp: kEndTimestamp
		});
	}

	// Ежесекундный цикл обратного отсчета времени
	function StartTicks() {
		if (timer_id !== undefined) {
			clearInterval(timer_id);
		}
		SaveCurrentState();

		timer_id = setInterval(() => {
			if (seconds_left > 0) {
				seconds_left--;
				if (current_mode === 'work') {
					stats_data.total_work_seconds++;
				} else {
					stats_data.total_break_seconds++;
				}
				context.globalState.update('pomodoro_stats_data', stats_data);
				UpdateDisplay();
			} else {
				// Логика автоматического переключения режимов при достижении нуля
				clearInterval(timer_id);
				is_running = false;
				context.workspaceState.update('pomodoro_timer_state', undefined);
				const kConfig = vscode.workspace.getConfiguration('pomodoro');
				const kToday = new Date().toLocaleDateString();

				if (current_mode === 'work') {
					current_mode = 'break';
					stats_data.completed_cycles++;
					stats_data.history.push({ date: kToday, type: 'work', duration_seconds: kConfig.get<number>('workDuration', 25) * 60 });

					const kCyclesBeforeLong = kConfig.get<number>('cyclesBeforeLongBreak', 4);
					if (stats_data.completed_cycles % kCyclesBeforeLong === 0) {
						seconds_left = kConfig.get<number>('longBreakDuration', 15) * 60;
					} else {
						seconds_left = kConfig.get<number>('shortBreakDuration', 5) * 60;
					}
					vscode.window.showWarningMessage("Time to rest!");
				} else {
					current_mode = 'work';
					seconds_left = kConfig.get<number>('workDuration', 25) * 60;
					stats_data.history.push({ date: kToday, type: 'break', duration_seconds: kConfig.get<number>('shortBreakDuration', 5) * 60 });
					vscode.window.showInformationMessage("Back to work!");
				}
				context.globalState.update('pomodoro_stats_data', stats_data);
				ToggleTimer();
			}
		}, 1000);
	}
	// Изменение состояния таймера между запуском и паузой
	function ToggleTimer() {
		if (is_running === true) {
			is_running = false;
			if (timer_id !== undefined) {
				clearInterval(timer_id);
			}
			SaveCurrentState();
		} else {
			is_running = true;
			StartTicks();
		}
		UpdateDisplay();
	}

	// Полный сброс таймера на начальные значения
	function ResetTimer() {
		is_running = false;
		if (timer_id !== undefined) {
			clearInterval(timer_id);
		}
		context.workspaceState.update('pomodoro_timer_state', undefined);
		current_mode = 'work';
		ResetTimerValue();
		UpdateDisplay();
		vscode.window.showInformationMessage("Pomodoro timer reset.");
	}

	// Досрочное завершение перерыва с модальным подтверждением
	async function SkipBreak() {
		if (current_mode !== 'break') {
			vscode.window.showErrorMessage("You can only skip a break phase.");
			return;
		}
		const kChoice = await vscode.window.showWarningMessage(
			"Do you really want to skip the rest phase?",
			{ modal: true },
			"Yes, skip it"
		);
		if (kChoice === "Yes, skip it") {
			is_running = false;
			if (timer_id !== undefined) {
				clearInterval(timer_id);
			}
			context.workspaceState.update('pomodoro_timer_state', undefined);
			stats_data.early_break_stops++;
			context.globalState.update('pomodoro_stats_data', stats_data);
			current_mode = 'work';
			ResetTimerValue();
			UpdateDisplay();
			vscode.window.showInformationMessage("Break skipped. Ready to work.");
		}
	}

	// Проверка режима отдыха и фиксация попыток сборки или запуска кода
	function CheckBlock(): boolean {
		if (current_mode === 'break' && is_running === true) {
			stats_data.blocked_execution_attempts++;
			context.globalState.update('pomodoro_stats_data', stats_data);
			const kMinutes = Math.floor(seconds_left / 60).toString().padStart(2, '0');
			const kSeconds = (seconds_left % 60).toString().padStart(2, '0');
			vscode.window.showErrorMessage(`Rest time! Code execution blocked. Remaining: ${kMinutes}:${kSeconds}`);
			return true;
		}
		return false;
	}

	// Подсчет и вывод агрегированной статистики за день и за неделю
	function ShowStats() {
		const kToday = new Date().toLocaleDateString();

		let today_work_seconds = 0;
		let week_work_seconds = 0;
		const kOneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

		// Использование стандартного цикла для подсчета времени из истории сессий
		for (let i = 0; i < stats_data.history.length; i++) {
			const h = stats_data.history[i];
			if (h !== undefined && h !== null) {
				if (h.date === kToday && h.type === 'work') {
					today_work_seconds += (h.duration_seconds || 0);
				}
				if (new Date(h.date).getTime() >= kOneWeekAgo && h.type === 'work') {
					week_work_seconds += (h.duration_seconds || 0);
				}
			}
		}

		const kTodayWork = Math.round(today_work_seconds / 60);
		const kWeekWork = Math.round(week_work_seconds / 60);
		const kTotalWorkMin = Math.round((stats_data.total_work_seconds || 0) / 60);
		const kTotalBreakMin = Math.round((stats_data.total_break_seconds || 0) / 60);

		const kMessage = `POMODORO REPORT:\n\n` +
			`• Total Completed Cycles: ${stats_data.completed_cycles}\n` +
			`• Exact Work Time: ${kTotalWorkMin} min\n` +
			`• Exact Break Time: ${kTotalBreakMin} min\n` +
			`• Blocked Code Launches: ${stats_data.blocked_execution_attempts}\n` +
			`• Early Break Stops: ${stats_data.early_break_stops}\n\n` +
			`♻️ TODAY:\n` +
			`  - Work Duration: ${kTodayWork} min\n\n` +
			`♻️ LAST 7 DAYS:\n` +
			`  - Work Duration: ${kWeekWork} min`;

		vscode.window.showInformationMessage(kMessage, { modal: true });
	}

	// Настройка длительности интервалов через всплывающие окна ввода диалога
	async function ConfigureSettings() {
		const kConfig = vscode.workspace.getConfiguration('pomodoro');

		const kWorkInput = await vscode.window.showInputBox({ prompt: "Work duration (minutes)", value: kConfig.get<number>('workDuration', 25).toString() });
		if (kWorkInput === undefined || kWorkInput === "") { return; }

		const kShortInput = await vscode.window.showInputBox({ prompt: "Short break duration (minutes)", value: kConfig.get<number>('shortBreakDuration', 5).toString() });
		if (kShortInput === undefined || kShortInput === "") { return; }

		const kLongInput = await vscode.window.showInputBox({ prompt: "Long break duration (minutes)", value: kConfig.get<number>('longBreakDuration', 15).toString() });
		if (kLongInput === undefined || kLongInput === "") { return; }

		const kCyclesInput = await vscode.window.showInputBox({ prompt: "Cycles before long break", value: kConfig.get<number>('cyclesBeforeLongBreak', 4).toString() });
		if (kCyclesInput === undefined || kCyclesInput === "") { return; }

		await kConfig.update('workDuration', parseInt(kWorkInput) || 25, vscode.ConfigurationTarget.Global);
		await kConfig.update('shortBreakDuration', parseInt(kShortInput) || 5, vscode.ConfigurationTarget.Global);
		await kConfig.update('longBreakDuration', parseInt(kLongInput) || 15, vscode.ConfigurationTarget.Global);
		await kConfig.update('cyclesBeforeLongBreak', parseInt(kCyclesInput) || 4, vscode.ConfigurationTarget.Global);

		if (is_running === false) {
			ResetTimerValue();
			UpdateDisplay();
		}
		vscode.window.showInformationMessage("All configurations updated.");
	}

	// Регистрация подписок на события отладки, сборщика задач и команд плагина
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession(() => {
			if (CheckBlock() === true) {
				vscode.commands.executeCommand('workbench.action.debug.stop');
			}
		}),
		vscode.tasks.onDidStartTask((event) => {
			if (CheckBlock() === true) {
				event.execution.terminate();
			}
		}),
		vscode.tasks.onDidStartTaskProcess((event) => {
			if (CheckBlock() === true) {
				event.execution.terminate();
			}
		}),
		vscode.commands.registerCommand('pomodoro.start', () => {
			if (is_running === false) {
				is_running = true;
				StartTicks();
				UpdateDisplay();
			}
		}),
		vscode.commands.registerCommand('pomodoro.pause', () => {
			if (is_running === true) {
				is_running = false;
				if (timer_id !== undefined) {
					clearInterval(timer_id);
				}
				SaveCurrentState();
				UpdateDisplay();
			}
		}),
		vscode.commands.registerCommand('pomodoro.toggle', () => {
			ToggleTimer();
		}),
		vscode.commands.registerCommand('pomodoro.reset', () => {
			ResetTimer();
		}),
		vscode.commands.registerCommand('pomodoro.skip_break', () => {
			SkipBreak();
		}),
		vscode.commands.registerCommand('pomodoro.showStats', () => {
			ShowStats();
		}),
		vscode.commands.registerCommand('pomodoro.configure', () => {
			ConfigureSettings();
		})
	);

	// Связывание графических кнопок с зарегистрированными командами
	kTimerButton.command = 'pomodoro.configure';
	kStartButton.command = 'pomodoro.start';
	kPauseButton.command = 'pomodoro.pause';
	kResetButton.command = 'pomodoro.reset';
	kStatsButton.command = 'pomodoro.showStats';

	UpdateDisplay();

	context.subscriptions.push(kTimerButton, kStartButton, kPauseButton, kResetButton, kStatsButton);
}

export function deactivate() {}        
