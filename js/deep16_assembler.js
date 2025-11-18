// In deep16_ui.js - Fix the assemble method
assemble() {
    console.log("Assemble button clicked");
    const source = this.editorElement.value;
    this.status("Assembling...");
    this.addTranscriptEntry("Starting assembly", "info");

    try {
        const result = this.assembler.assemble(source);
        console.log("Assembly result:", result);
        
        this.currentAssemblyResult = result;
        
        if (result.success) {
            // DON'T clear the entire memory! Only update the changed locations
            for (const change of result.memoryChanges) {
                if (change.address < this.simulator.memory.length) {
                    this.simulator.memory[change.address] = change.value;
                }
            }
            
            // Debug: Check simulator memory after load
            console.log("Simulator memory at 0x0000:", this.simulator.memory[0].toString(16));
            
            this.simulator.registers[15] = 0x0000;
            this.status("Assembly successful! Program loaded.");
            this.addTranscriptEntry("Assembly successful - program loaded", "success");
            document.getElementById('run-btn').disabled = false;
            document.getElementById('step-btn').disabled = false;
            document.getElementById('reset-btn').disabled = false;
            
            this.updateSymbolSelects(result.symbols);
            this.addTranscriptEntry(`Found ${Object.keys(result.symbols).length} symbols`, "info");
            
            this.switchTab('listing');
        } else {
            const errorMsg = `Assembly failed with ${result.errors.length} error(s)`;
            this.status("Assembly errors - see errors tab for details");
            this.addTranscriptEntry(errorMsg, "error");
            this.switchTab('errors');
        }

        this.updateAllDisplays();
        this.updateErrorsList();
        this.updateAssemblyListing();
    } catch (error) {
        console.error("Assembly error:", error);
        this.status("Assembly failed with exception");
        this.addTranscriptEntry(`Assembly exception: ${error.message}`, "error");
    }
}
