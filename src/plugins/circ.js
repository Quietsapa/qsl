/**
 * Check for circular dependencies in flows and processes.
 * @param {*} QSL 
 */
export default function(QSL) {
    QSL.loadActions.add(function() {
        /**
         * Helper function to detect circular dependencies
         */
        const detectCircularDependency = (id, getDeps, visited = new Set()) => {
            if (visited.has(id)) return true;
            visited.add(id);
            const deps = getDeps(id) || [];
            for (const depId of deps) {
                if (detectCircularDependency(depId, getDeps, new Set(visited))) return true;
            }
            return false;
        };
        
        /**
         * Check for circular dependencies in flows
         */
        const getFlowDeps = id => (this.flowOptions.get(this.normalizeFlowId(id))?.depends) || [];
        for (const [fid, options] of this.flowOptions.entries()) {
            if (Array.isArray(options.depends) && options.depends.length) {
                if (detectCircularDependency(fid, getFlowDeps)) {
                    this.log('CIRC_FLOW_DEP_SKIPPED', fid, options.depends);
                    this.setFlowOptions({ status: this.FLOW_STATE.COMPLETED }, fid); /* Mark as completed */
                }
            }
        }

        /**
         * Check for circular dependencies in processes
         */
        const getProcDeps = id => {
            for (const flow of this.flows.values()) {
                const proc = flow.find(p => p.id === id);
                if (proc && Array.isArray(proc.depends)) return proc.depends.map(dep => this.PREFIX + dep);
            }
            return [];
        };
        for (const flow of this.flows.values()) {
            for (const process of flow) {
                if (Array.isArray(process.depends) && process.depends.length) {
                    if (detectCircularDependency(process.id, getProcDeps)) {
                        this.log('CIRC_PROCESS_DEP_SKIPPED', process.id, process.depends);
                        process.condition = false; /* Turn off condition */
                    }
                }
            }
        }
    });

    if ( QSL.logger && QSL.logger.VERSION === 'qsl-logger' ) {
        QSL.logger.LOG.CIRC_FLOW_DEP_SKIPPED = '[QSL] Circular flow dependency skipped:';
        QSL.logger.LOG.CIRC_PROCESS_DEP_SKIPPED = '[QSL] Circular process dependency skipped:';
    }
}
