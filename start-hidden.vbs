' Launches Troll Remote with NO console window and no taskbar button.
' (First run: double-click start.bat once to install, then use this every day.)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists("node_modules") Then
  ' Dependencies missing: install them (visible, one time) before starting.
  sh.Run "cmd /c npm install", 1, True
End If
' 0 = hidden window, False = don't wait. Runs the app with no visible console.
sh.Run "cmd /c npm start", 0, False
