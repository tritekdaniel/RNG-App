#![cfg_attr(
    all(debug_assertions, not(test), target_os = "windows"),
    windows_subsystem = "windows"
)]

use rand::Rng;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AppState {
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub used_outputs: Vec<usize>,
    pub output_mode: String,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inputs: vec![],
            outputs: vec![],
            used_outputs: vec![],
            output_mode: "single".to_string(),
        }
    }

    pub fn generate_next(&mut self) -> Result<Option<String>, String> {
        let available_indices: Vec<usize> = (0..self.inputs.len())
            .filter(|i| !self.used_outputs.contains(i))
            .collect();

        if available_indices.is_empty() {
            return Ok(None);
        }

        let idx = rand::thread_rng().gen_range(0..available_indices.len());
        let item = self.inputs[available_indices[idx]].clone();
        self.used_outputs.push(available_indices[idx]);
        self.outputs.push(item.clone());
        Ok(Some(item))
    }

    pub fn generate_all(&mut self) -> Result<Vec<String>, String> {
        use rand::seq::SliceRandom;

        let available_indices: Vec<usize> = (0..self.inputs.len())
            .filter(|i| !self.used_outputs.contains(i))
            .collect();

        if available_indices.is_empty() {
            return Ok(vec![]);
        }

        let mut shuffled = available_indices;
        shuffled.shuffle(&mut rand::thread_rng());

        for &idx in &shuffled {
            self.used_outputs.push(idx);
            self.outputs.push(self.inputs[idx].clone());
        }

        Ok(shuffled.iter().map(|&i| self.inputs[i].clone()).collect())
    }

    pub fn set_output_mode(&mut self, mode: String) {
        if mode == "single" || mode == "batch" {
            self.output_mode = mode;
        }
    }

    pub fn add_input(&mut self, value: String) {
        if !value.is_empty() {
            self.inputs.push(value);
        }
    }

    pub fn remove_input(&mut self, index: usize) -> Option<String> {
        if index < self.inputs.len() {
            Some(self.inputs.remove(index))
        } else {
            None
        }
    }

    pub fn clear_inputs(&mut self) {
        self.inputs.clear();
    }

    pub fn update_input(&mut self, index: usize, value: String) -> Result<(), String> {
        if index < self.inputs.len() {
            self.inputs[index] = value;
            Ok(())
        } else {
            Err("Index out of bounds".to_string())
        }
    }

    pub fn remove_output(&mut self, value: &str) {
        if let Some(pos) = self.outputs.iter().position(|x| x == value) {
            self.outputs.remove(pos);
        }
    }

    pub fn clear_outputs(&mut self) {
        self.outputs.clear();
        self.used_outputs.clear();
    }
}

pub struct AppStateWrapper(pub Mutex<AppState>);

impl Clone for AppStateWrapper {
    fn clone(&self) -> Self {
        AppStateWrapper(Mutex::new(self.0.lock().unwrap().clone()))
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            app.manage(AppStateWrapper(Mutex::new(AppState::new())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            add_input,
            remove_input,
            clear_inputs,
            update_input,
            generate,
            batch_generate,
            set_output_mode,
            remove_output,
            clear_outputs,
            send_notification
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_state(state: tauri::State<AppStateWrapper>) -> AppState {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn add_input(state: tauri::State<AppStateWrapper>, value: String) -> AppState {
    let mut locked = state.0.lock().unwrap();
    locked.add_input(value);
    locked.clone()
}

#[tauri::command]
fn remove_input(state: tauri::State<AppStateWrapper>, index: usize) -> AppState {
    let mut locked = state.0.lock().unwrap();
    locked.remove_input(index);
    locked.clone()
}

#[tauri::command]
fn clear_inputs(state: tauri::State<AppStateWrapper>) -> AppState {
    let mut locked = state.0.lock().unwrap();
    locked.clear_inputs();
    locked.clone()
}

#[tauri::command]
fn generate(state: tauri::State<AppStateWrapper>) -> Option<String> {
    state.0.lock().unwrap().generate_next().unwrap_or(None)
}

#[tauri::command]
fn remove_output(state: tauri::State<AppStateWrapper>, value: String) -> AppState {
    let mut locked = state.0.lock().unwrap();
    locked.remove_output(&value);
    locked.clone()
}

#[tauri::command]
fn clear_outputs(state: tauri::State<AppStateWrapper>) -> AppState {
    let mut locked = state.0.lock().unwrap();
    locked.clear_outputs();
    locked.clone()
}

#[tauri::command]
fn update_input(state: tauri::State<AppStateWrapper>, index: usize, value: String) -> Result<(), String> {
    state.0.lock().unwrap().update_input(index, value)
}

#[tauri::command]
fn batch_generate(state: tauri::State<AppStateWrapper>) -> (Vec<String>, AppState) {
    let mut locked = state.0.lock().unwrap();
    let result = locked.generate_all().unwrap_or_default();
    let new_state = locked.clone();
    (result, new_state)
}

#[tauri::command]
fn set_output_mode(state: tauri::State<AppStateWrapper>, mode: String) -> AppState {
    let mut locked = state.0.lock().unwrap();
    locked.set_output_mode(mode);
    locked.clone()
}

#[tauri::command]
fn send_notification(app: tauri::AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(&title).body(&body).show();
}
