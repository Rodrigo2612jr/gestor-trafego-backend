Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "c:\Users\DELL\Desktop\gestor-trafego-backend"
WshShell.Run """C:\Program Files\nodejs\node.exe"" server.js", 0, False
