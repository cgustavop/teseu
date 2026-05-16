#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

struct ApiProcess(Mutex<Option<Child>>);

fn wait_for_api(port: u16, timeout_ms: u64) -> bool {
    let url = format!("http://localhost:{}/stats", port);
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    while std::time::Instant::now() < deadline {
        if reqwest::blocking::get(&url).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn main() {
    tauri::Builder::default()
        .manage(ApiProcess(Mutex::new(None)))
        .setup(|app| {
            // spawn FastAPI server
            let child = Command::new("python")
                .args([
                    "-m", "uvicorn",
                    "teseu.api:app",
                    "--host", "127.0.0.1",
                    "--port", "7731",
                    "--log-level", "warning",
                ])
                .current_dir(env!("CARGO_MANIFEST_DIR").to_string() + "/../..")
                .spawn()
                .expect("Failed to start teseu API. Is Python installed?");

            *app.state::<ApiProcess>().0.lock().unwrap() = Some(child);

            // wait up to 15s for API to be ready
            let ready = wait_for_api(7731, 15_000);
            if !ready {
                eprintln!("teseu API did not start in time");
            }

            Ok(())
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event.event() {
                // kill Python on window close
                if let Some(mut child) = event
                    .window()
                    .state::<ApiProcess>()
                    .0
                    .lock()
                    .unwrap()
                    .take()
                {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
