/**
 * Handle dynamic flow assignment when resources are added after load has started.
 * @param {*} QSL 
 */
export default function(QSL) {
    /**
     * Handle dynamic flow assignment when resources are added after load has started.
     */
    QSL.addProcessFilters.add(function(flowId, config) {
        if (this.hasStarted && !flowId) {
            flowId = 'dynamic-' + Math.random().toString(36).slice(2);
            config.paused = true;
        }
        return [flowId, config];
    });

    /**
     * Filter out dynamic flows from initial processing.
     */
    QSL.flowIdFilters.add(function(flowIds) {
        return flowIds.filter(fid => !fid.includes('dynamic'));
    });

    /**
     * Process dynamic flows after all regular flows complete.
     * Checks if all non-dynamic flows are completed, then processes dynamic flows.
     */
    QSL.completedFlowsActions.add(function(flowsDone, flows, flowOptions) {
        if (!flowsDone || !flows || !flowOptions) return true;
        
        /**
         * Check if all non-dynamic flows are completed
         */
        const nonDynamicFlowsDone = [...flowOptions.entries()]
            .filter(([fid]) => !fid.includes('dynamic'))
            .every(([, opt]) => opt.status === this.FLOW_STATE.COMPLETED);
        
        if (!nonDynamicFlowsDone) return false;
        
        /**
         * Process dynamic flows
         */
        const dynamicFlowIds = [...flows.keys()].filter(fid => fid.includes('dynamic'));
        if (dynamicFlowIds.length === 0) return true;
        
        for (const dynamicFlowId of dynamicFlowIds) {
            const dynamicOptions = flowOptions.get(dynamicFlowId);
            
            if (dynamicOptions && dynamicOptions.status !== this.FLOW_STATE.COMPLETED) {
                if (dynamicOptions.status === this.FLOW_STATE.READY) {
                    this.setFlowOptions({ status: this.FLOW_STATE.RUNNING }, dynamicFlowId);
                    this.runFlow(dynamicFlowId);
                }
                return false;
            }
        }
        return true;
    });
}